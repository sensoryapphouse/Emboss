// Modern Universal Braille Embosser Spooler Subsystem
// Supports:
// 1. WebSerial USB (Direct virtual COM for Index, ViewPlus, Romeo, Braillo, custom MCUs)
// 2. WebUSB (Direct native USB Class 7 Printer / Vendor bulk streaming)
// 3. WebHID (Driverless universal USB for ESP32-S3, RP2040/RP2350, STM32, Arduino)
// 4. Web Bluetooth BLE (Direct wireless streaming via Custom GATT 0xFEB0 & Nordic UART)
// 5. Network REST & WebSockets (Direct HTTP /api/print and live telemetry)

import { rasterizeSvgToTiger } from './tiger-raster.mjs';
import { rasterizeSvgToIndex } from './index-raster.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

export { rasterizeSvgToTiger, rasterizeSvgToIndex };

// Messages shown to the user go through options.text(key, params, fallback) when the caller
// provides it (the editor's translations, keys app.spool.*; A33), else the English fallback.
function say(options, key, fallback, params = {}) {
  if (options && typeof options.text === 'function') return options.text(`app.spool.${key}`, params, fallback);
  return fallback.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

export function isWebSerialSupported() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.navigator?.serial);
}

export function isWebUsbSupported() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.navigator?.usb);
}

export function isWebBluetoothSupported() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.navigator?.bluetooth);
}

export function isWebHidSupported() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.navigator?.hid);
}

/**
 * GATT Service & Characteristic UUID definitions for Wireless BLE Embossers
 */
export const BLE_GATT_SERVICES = {
  // Primary Emboss Custom GATT Profile (Proposed improvements.md §2)
  EMBOSS_SERVICE: 0xFEB0,
  EMBOSS_SERVICE_UUID: '0000feb0-0000-1000-8000-00805f9b34fb',
  EMBOSS_RX_UUID: '0000feb1-0000-1000-8000-00805f9b34fb',      // Stream RX (WriteWithoutResponse)
  EMBOSS_TX_UUID: '0000feb2-0000-1000-8000-00805f9b34fb',      // Status/Telemetry TX (Notify)
  EMBOSS_CAPS_UUID: '0000feb3-0000-1000-8000-00805f9b34fb',    // Capabilities (Read)
  EMBOSS_CTRL_UUID: '0000feb4-0000-1000-8000-00805f9b34fb',    // Control Opcode (Write)

  // Standard Nordic UART Service (NUS)
  NORDIC_UART_SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  NORDIC_RX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  NORDIC_TX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',

  // Standard HM-10 / CC2541 BLE UART
  HM10_SERVICE: 0xFFE0,
  HM10_SERVICE_UUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
  HM10_CHAR_UUID: '0000ffe1-0000-1000-8000-00805f9b34fb'
};

/**
 * Embosser profiles for hardware auto-identification.
 */
export const KNOWN_EMBOSSER_PROFILES = [
  {
    id: 'index',
    name: 'Index Braille (Basic-D / Everest-D)',
    vendorIds: [0x11a9, 0x1868],
    productIds: [],
    autoApply: true,
    presets: { embosser: 'index', cells: 40, lines: 25, baudRate: 38400, embosserDuplex: 'double' }
  },
  {
    id: 'viewplus',
    name: 'ViewPlus Columbia / PixBlaster',
    vendorIds: [0x0bd7],
    productIds: [],
    autoApply: true,
    presets: { embosser: 'viewplus', cells: 40, lines: 25, baudRate: 115200, embosserDuplex: 'double' }
  },
  {
    id: 'romeo',
    name: 'Enabling Technologies (Romeo / Juliet)',
    vendorIds: [],
    productIds: [],
    autoApply: false,
    presets: { embosser: 'romeo', cells: 40, lines: 25, baudRate: 9600, embosserDuplex: 'double' }
  },
  {
    id: 'braillo',
    name: 'Braillo (300 / 450 / 600)',
    vendorIds: [],
    productIds: [],
    autoApply: false,
    presets: { embosser: 'braillo', cells: 40, lines: 25, baudRate: 9600, embosserDuplex: 'double' }
  },
  {
    id: 'dotpad',
    name: 'DotPad Dynamic Display (30×10 + 20 Braille)',
    vendorIds: [],
    productIds: [],
    autoApply: false,
    presets: { embosser: 'dotpad', cells: 20, lines: 10, baudRate: 115200, embosserDuplex: 'single' }
  },
  {
    id: 'custom-card',
    name: 'Simple One-Page Braille Printer (ESP32 / Pico / Arduino)',
    vendorIds: [0x2e8a, 0x303a, 0x0483, 0x2341],
    productIds: [],
    autoApply: false,
    presets: { embosser: 'generic', cells: 30, lines: 20, baudRate: 115200, embosserDuplex: 'single' }
  }
];

const GENERIC_PROFILE = {
  id: 'generic',
  name: 'Serial Braille Embosser',
  autoApply: false,
  presets: { embosser: 'generic', cells: 40, lines: 25, baudRate: 9600, embosserDuplex: 'double' }
};

/**
 * Identifies an embosser profile from a SerialPort's USB info.
 */
export function detectEmbosserFromPort(port) {
  if (!port || typeof port.getInfo !== 'function') return null;
  const info = port.getInfo();
  if (info.usbVendorId == null) return GENERIC_PROFILE;

  for (const profile of KNOWN_EMBOSSER_PROFILES) {
    if (profile.vendorIds.includes(info.usbVendorId)) {
      if (profile.productIds.length === 0 || profile.productIds.includes(info.usbProductId)) {
        return profile;
      }
    }
  }
  return GENERIC_PROFILE;
}

/**
 * Initializes automatic embosser detection when ports connect/disconnect.
 */
export function initEmbosserAutoDetect(onConnect, onDisconnect) {
  if (!isWebSerialSupported()) return;

  navigator.serial.addEventListener('connect', async (e) => {
    const profile = detectEmbosserFromPort(e.target);
    if (profile && profile.autoApply && typeof onConnect === 'function') {
      onConnect(profile, e.target);
    }
  });

  navigator.serial.addEventListener('disconnect', (e) => {
    if (typeof onDisconnect === 'function') {
      onDisconnect(e.target);
    }
  });
}

/**
 * Embossers read NABCC ASCII. Convert Unicode braille (U+2800–U+28FF) to NABCC ASCII.
 */
export function sanitizeBrfForEmbosser(text) {
  return unicodeBrailleToBrf(String(text || '')).replace(/[^\x20-\x7E\r\n\f]/g, ' ');
}

/**
 * Ensures every page break in `text` is a CR LF FF sequence rather than a bare
 * form feed, and that the stream ends with one even when the source text has
 * no trailing page break. This is the page-ending convention read from the
 * drivers for the three corrected profiles below: Enabling Technologies'
 * Model enum (RNF = CR LF FF for every non-Attaché model) and
 * AbstractBrailloDocumentHandler's explicit setEndOfPage([13,10,12]); ViewPlus
 * has no documented raw-mode ending of its own, so it is given the same one
 * used by the other legacy paths (see the "ViewPlus / Tiger" comment below).
 * Idempotent — a form feed already preceded by CR LF is left alone, so this
 * is safe to apply even if document.mjs/page.mjs ever start emitting CR LF
 * before their page breaks.
 */
function withCrlfFormFeedPages(text) {
  let out = text.replace(/(\r\n)?\f/g, '\r\n\f');
  if (!out.endsWith('\r\n\f')) out += '\r\n\f';
  return out;
}

/**
 * Formats a BRF string specifically for physical embosser hardware.
 */
export function prepareEmbosserStream(brfText, options = {}) {
  const model = typeof options === 'string' ? options : (options.embosser || options.model || 'generic');
  const cols = Number(options.width || options.cols) || 40;
  const rows = Number(options.depth || options.rows) || 25;
  const duplexOpt = options.duplex ?? options.embosserDuplex;
  const duplex = duplexOpt === 'single' ? 1 : 2;

  let text = sanitizeBrfForEmbosser(brfText).replace(/\r\n|\r|\n/g, '\r\n');
  const m = model.toLowerCase();

  if (m === 'index' || m === 'everest' || m === 'basic-d' || m === 'pageblaster') {
    const prefix = `\x1bDP${duplex}`;
    if (!text.endsWith('\x0c') && !text.endsWith('\x0c\r\n')) {
      text += '\x0c';
    }
    text = prefix + text + '\x1a';
    if (text.length % 64 === 0) {
      text += '\x1a';
    }
    return text;
  }

  if (m === 'romeo' || m === 'juliet' || m === 'enabling' || m === 'thomas') {
    // Enabling Technologies (Romeo, Juliet, Thomas, Marathon) — every byte below is
    // taken from EnablingTechnologiesDocumentHandler's private constructor in APH's
    // shipped libembosser-core-drivers-1.4.3.jar (read with javap: the class has no
    // published source, and no manufacturer manual was found — see A12 in
    // EMBOSS-TASKS.md). NONE of this has been tested on real Enabling Technologies
    // hardware; these machines also ignore escape sequences entirely unless the
    // front-panel parameter 23 has been switched on by hand (Duxbury's technical
    // note), which no software can do.
    //
    // The constructor writes nine escape commands, in this order, to a
    // ByteArrayDataOutput (offsets from the decompiled bytecode):
    //   ESC A @ @   (27,65,64,64) — fixed opener
    //   ESC K @     (27,75,64)    — fixed
    //   ESC W @     (27,87,64)    — fixed
    //   ESC i <b>   — b from the DUPLEX_MAPPING map: INTERPOINT(double-sided)=0x40,
    //                 P1ONLY(single-sided)=0x41 (P2ONLY=0x42 is not reachable from
    //                 Emboss's duplex setting, which only distinguishes single/double)
    //   ESC s <b>   — b from the CELL_MAPPING map: NLS(standard 6-dot cell)=0x40.
    //                 Emboss has no cell-type setting, so NLS (the Builder's own
    //                 default) is always sent.
    //   ESC L A     (27,76,65)    — fixed
    //   ESC R <n+64>  — n = leftMargin + cellsPerLine, i.e. Emboss's cols. leftMargin
    //                   is fixed at 0 (the Builder's own default; Emboss has no
    //                   left-margin setting), so n is simply cols.
    //   ESC T <n+64>  — n = pageLength, a physical sheet length in inches that the
    //                   constructor uses only for a bounds check. It has nothing to
    //                   do with columns. Emboss has no such setting, so the Builder's
    //                   own default (11 inches, i.e. n=11, byte 0x4B) is sent fixed.
    //   ESC Q <n+64>  — n = topMargin + linesPerPage, i.e. Emboss's rows (topMargin
    //                   is fixed at 0, the Builder's own default, for the same reason
    //                   as leftMargin above).
    // A12's research note guessed "ESC R <rows+64>, ESC T <cols+64>, ESC Q
    // <copies+64>" from the letters alone. The constructor's bytecode disagrees on
    // all three: R carries the column count (not rows), T is a fixed physical page
    // length (not columns), and Q carries the row count (not copies — there is no
    // copies byte in this header at all; the driver applies "copies" by re-emboss-
    // ing the whole document, not via an escape command). The driver wins.
    const duplexByte = duplex === 1 ? 0x41 : 0x40; // P1ONLY : INTERPOINT
    const cellByte = 0x40; // NLS
    const rByte = 0x40 + cols;  // leftMargin(0) + cellsPerLine
    const tByte = 0x40 + 11;    // fixed pageLength(11in), driver's own default — 0x4B
    const qByte = 0x40 + rows;  // topMargin(0) + linesPerPage
    const header = '\x1bA@@\x1bK@\x1bW@' +
      '\x1bi' + String.fromCharCode(duplexByte) +
      '\x1bs' + String.fromCharCode(cellByte) +
      '\x1bLA' +
      '\x1bR' + String.fromCharCode(rByte) +
      '\x1bT' + String.fromCharCode(tByte) +
      '\x1bQ' + String.fromCharCode(qByte);
    // Model.getLineEnd()/getPageEnd()/getDocEnd(), for every non-Attaché,
    // non-Trident/Cyclone/Phoenix model (which covers Romeo, Juliet, Thomas and,
    // absent a more specific submodel from Emboss, Marathon too): CR LF lines
    // (TextEmbosserModel.RN), CR LF FF pages (TextEmbosserModel.RNF), and an empty
    // footer (ImmutableList.of()) — i.e. no trailing byte at all. Previously Emboss
    // sent a bare SUB (0x1a) trailer and never put a form feed at page breaks; both
    // are wrong per this driver and are fixed here.
    return header + withCrlfFormFeedPages(text);
  }

  if (m === 'viewplus' || m === 'columbia' || m === 'pixblaster' || m === 'tiger' || m === 'premier' || m === 'embraille') {
    // ViewPlus / Tiger — BrailleBlaster's ViewPlusEmbosser class (libembosser-
    // viewplus-driver-1.4.3.jar, read with javap) extends BaseGraphicsEmbosser and
    // writes NO header or trailer bytes of its own at all: it drives the machine as
    // a graphics/PCL printer, rendering braille through an installed "Braille29"
    // font, not by sending raw escape codes down a serial link. `\x1b*t` was an
    // invented, incomplete PCL fragment and is removed, along with its unconditional
    // trailing form feed. No ViewPlus raw/legacy-ASCII protocol document was found
    // (see A12 in EMBOSS-TASKS.md); if a particular unit exposes one, plain BRF
    // with ordinary CR LF / CR LF FF endings — the same convention the other
    // legacy paths above use — is the closest a byte stream can offer. This is NOT
    // tested on real ViewPlus hardware. If the interface text ever explains this to
    // the user, it should say a ViewPlus embosser is normally driven through its
    // own vendor-supplied printer driver, not this raw serial path — that text
    // lives in Emboss/web/, which is out of scope here.
    return withCrlfFormFeedPages(text);
  }

  if (m === 'braillo') {
    // Braillo (200, 300, 400, 600) — bytes taken from Braillo200DocumentHandler's
    // private constructor format string in APH's shipped
    // libembosser-braillo-driver-1.4.3.jar (read with javap; no Braillo manual was
    // found — see A12 in EMBOSS-TASKS.md). NOT tested on real Braillo hardware. The
    // 270-series firmware uses a different command set again (Braillo270Document-
    // Handler) and is out of scope for this "Braillo" profile.
    //   ESC S1 ESC J0 ESC N0 ESC R0   — fixed reset/mode bytes
    //   ESC A<rows, 2-digit ASCII>    — Emboss's linesPerPage (rows) setting
    //   ESC B<cols, 2-digit ASCII>    — Emboss's cellsPerLine (cols) setting
    //   ESC C<0|1>                    — interpoint: 1 = double-sided, 0 = single
    //   ESC H<0|1>                    — z-folding. Emboss has no z-fold setting;
    //                                    0 is Braillo200DocumentHandler$Builder's own
    //                                    default (its `zfolding` field is never set
    //                                    in the builder's constructor, so it keeps
    //                                    Java's default `false`).
    const interpointDigit = duplex === 1 ? 0 : 1;
    const header = '\x1bS1\x1bJ0\x1bN0\x1bR0' +
      `\x1bA${String(rows).padStart(2, '0')}` +
      `\x1bB${String(cols).padStart(2, '0')}` +
      `\x1bC${interpointDigit}` +
      '\x1bH0';
    // AbstractBrailloDocumentHandler: explicit CR LF FF page endings; CR LF line
    // endings and an empty footer are GenericTextDocumentHandler$Builder's own
    // defaults, never overridden by the Braillo handler — so no trailing byte.
    return header + withCrlfFormFeedPages(text);
  }

  if (!text.endsWith('\x0c') && !text.endsWith('\x0c\r\n')) {
    text += '\x0c';
  }
  return text;
}

/** Asks the browser to choose a Bluetooth embosser. Must run inside the user's click. { device } or { cancelled, message }. */
export async function requestBluetoothDevice(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  onStatus(say(options, 'ble_select', "Please select your Bluetooth embosser in the browser prompt…", {}));
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Emboss' },
        { namePrefix: 'Braille' },
        { namePrefix: 'DotPad' },
        { namePrefix: 'Monarch' },
        { namePrefix: 'ESP32' },
        { services: [BLE_GATT_SERVICES.EMBOSS_SERVICE] },
        { services: [BLE_GATT_SERVICES.NORDIC_UART_SERVICE] },
        { services: [BLE_GATT_SERVICES.HM10_SERVICE] },
      ],
      optionalServices: [
        BLE_GATT_SERVICES.EMBOSS_SERVICE,
        BLE_GATT_SERVICES.EMBOSS_SERVICE_UUID,
        BLE_GATT_SERVICES.NORDIC_UART_SERVICE,
        BLE_GATT_SERVICES.HM10_SERVICE,
        BLE_GATT_SERVICES.HM10_SERVICE_UUID,
        'generic_access',
        'device_information'
      ]
    });
    return { device };
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.message && (err.message.includes('User cancelled') || err.message.includes('No device selected')))) {
      return { cancelled: true, message: say(options, 'ble_cancelled', "Bluetooth embosser selection was cancelled.", {}) };
    }
    throw err;
  }
}

/**
 * Direct wireless hardware spooling via Web Bluetooth (BLE).
 */
export async function spoolViaWebBluetooth(formattedStream, options = {}) {
  if (!isWebBluetoothSupported()) throw new Error('Web Bluetooth is not supported in this browser.');
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let device = options.device || null;   // chosen earlier, inside the click (S3c, S2-Q2: see chooseEmbosserTarget)
  if (!device) {
    const picked = await requestBluetoothDevice(options);
    if (picked.cancelled) return { success: false, method: 'cancelled', message: picked.message };
    device = picked.device;
  }

  onStatus(say(options, 'connecting_device', "Connecting to {device}…", { device: device.name || 'Bluetooth' }));
  let server;
  try {
    server = await device.gatt.connect();
  } catch (err) {
    throw new Error(`Could not connect to ${device.name || 'the Bluetooth embosser'}: ${err && err.message ? err.message : err}`);
  }

  let rxChar = null;
  let txChar = null;

  // 1. Try Custom Emboss Service
  try {
    const service = await server.getPrimaryService(BLE_GATT_SERVICES.EMBOSS_SERVICE).catch(() => server.getPrimaryService(BLE_GATT_SERVICES.EMBOSS_SERVICE_UUID));
    if (service) {
      rxChar = await service.getCharacteristic(BLE_GATT_SERVICES.EMBOSS_RX_UUID).catch(() => null);
      txChar = await service.getCharacteristic(BLE_GATT_SERVICES.EMBOSS_TX_UUID).catch(() => null);
    }
  } catch (_) {}

  // 2. Fallback to Nordic UART Service
  if (!rxChar) {
    try {
      const service = await server.getPrimaryService(BLE_GATT_SERVICES.NORDIC_UART_SERVICE);
      if (service) {
        rxChar = await service.getCharacteristic(BLE_GATT_SERVICES.NORDIC_RX).catch(() => null);
        txChar = await service.getCharacteristic(BLE_GATT_SERVICES.NORDIC_TX).catch(() => null);
      }
    } catch (_) {}
  }

  // 3. Fallback to HM-10 Service
  if (!rxChar) {
    try {
      const service = await server.getPrimaryService(BLE_GATT_SERVICES.HM10_SERVICE).catch(() => server.getPrimaryService(BLE_GATT_SERVICES.HM10_SERVICE_UUID));
      if (service) {
        rxChar = await service.getCharacteristic(BLE_GATT_SERVICES.HM10_CHAR_UUID).catch(() => null);
      }
    } catch (_) {}
  }

  if (!rxChar) {
    if (device.gatt.connected) device.gatt.disconnect();
    throw new Error('No writable BLE characteristic found on this device.');
  }

  if (txChar && typeof txChar.startNotifications === 'function') {
    try {
      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', (e) => {
        try {
          const val = new TextDecoder().decode(e.target.value);
          const telemetry = JSON.parse(val);
          if (telemetry.event === 'page_started') {
            onStatus(say(options, 'page_progress', "Embossing page {page} of {pages}…", { page: telemetry.page, pages: telemetry.totalPages || '…' }));
          } else if (telemetry.event === 'job_finished') {
            onStatus(say(options, 'job_finished', "Embossing job finished!", {}));
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  const data = new TextEncoder().encode(formattedStream);
  onStatus(say(options, 'ble_streaming', "Streaming {bytes} bytes over Bluetooth Low Energy…", { bytes: data.length }));

  const chunkSize = options.bleChunkSize || 128;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize);
    if (rxChar.writeValueWithoutResponse) {
      await rxChar.writeValueWithoutResponse(chunk);
    } else {
      await rxChar.writeValue(chunk);
    }
    onStatus(say(options, 'sent_ble', "Sent {sent} / {bytes} bytes (Bluetooth)…", { sent: Math.min(offset + chunkSize, data.length), bytes: data.length }));
    if (offset + chunkSize < data.length) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  onStatus(say(options, 'ble_done', "Emboss job delivered wirelessly via Bluetooth!", {}));
  return {
    success: true,
    method: 'web-bluetooth',
    message: say(options, 'ble_success', "Sent {bytes} bytes to {device}.", { bytes: data.length, device: device.name || 'Bluetooth' })
  };
}

/** Asks the browser to choose a USB HID embosser. Must run inside the user's click. { device } or { cancelled, message }. */
export async function requestHidDevice(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const filters = [
    { vendorId: 0x303a }, // Espressif ESP32-S3
    { vendorId: 0x2e8a }, // Raspberry Pi RP2040 / RP2350
    { vendorId: 0x0483 }, // STMicroelectronics
    { vendorId: 0x2341 }, // Arduino
    { vendorId: 0x1868 }, // Index Braille V5
    { vendorId: 0x0bd7 }, // ViewPlus
  ];
  onStatus(say(options, 'hid_select', "Please select your USB HID embosser in the browser prompt…", {}));
  let devices = [];
  try {
    devices = await navigator.hid.requestDevice({ filters });
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.message && (err.message.includes('User cancelled') || err.message.includes('No device selected')))) {
      return { cancelled: true, message: say(options, 'hid_cancelled', "HID device selection was cancelled.", {}) };
    }
    throw err;
  }
  if (!devices || !devices.length) {
    return { cancelled: true, message: say(options, 'hid_none', "No HID embosser selected.", {}) };
  }
  return { device: devices[0] };
}

/**
 * Direct driverless hardware spooling via WebHID API (Universal USB).
 */
export async function spoolViaWebHid(formattedStream, options = {}) {
  if (!isWebHidSupported()) throw new Error('WebHID is not supported in this browser.');
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let device = options.device || null;   // chosen earlier, inside the click (S3c, S2-Q2: see chooseEmbosserTarget)
  if (!device) {
    const picked = await requestHidDevice(options);
    if (picked.cancelled) return { success: false, method: 'cancelled', message: picked.message };
    device = picked.device;
  }
  if (!device.opened) {
    await device.open();
  }

  onStatus(say(options, 'hid_connected', "Connected to HID embosser: {device}…", { device: device.productName || 'USB HID' }));

  const data = new TextEncoder().encode(formattedStream);
  const reportId = 0x00;
  const reportSize = 64;

  for (let offset = 0; offset < data.length; offset += reportSize) {
    const chunk = new Uint8Array(reportSize);
    const slice = data.subarray(offset, offset + reportSize);
    chunk.set(slice);
    await device.sendReport(reportId, chunk);
    onStatus(say(options, 'sent_hid', "Sent {sent} / {bytes} bytes (USB HID)…", { sent: Math.min(offset + reportSize, data.length), bytes: data.length }));
    if (offset + reportSize < data.length) {
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  await device.close();
  onStatus(say(options, 'hid_done', "Emboss job sent via WebHID!", {}));
  return {
    success: true,
    method: 'web-hid',
    message: say(options, 'hid_success', "Sent {bytes} bytes via WebHID to {device}.", { bytes: data.length, device: device.productName || 'USB HID' })
  };
}

/** Asks the browser to choose a USB embosser (WebUSB). Must run inside the user's click. { device } or { cancelled, message }. */
export async function requestUsbDevice(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const filters = [
    { vendorId: 0x1868 },
    { vendorId: 0x11a9 },
    { vendorId: 0x0bd7 },
    { vendorId: 0x2e8a },
  ];
  onStatus(say(options, 'usb_select', "Please select your USB embosser in the browser prompt…", {}));
  try {
    return { device: await navigator.usb.requestDevice({ filters }) };
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.message && (err.message.includes('No device selected') || err.message.includes('User cancelled')))) {
      return { cancelled: true, message: say(options, 'usb_cancelled', "Embosser selection was cancelled.", {}) };
    }
    throw err;
  }
}

/**
 * Direct hardware spooling via WebUSB API.
 */
export async function spoolViaWebUsb(formattedStream, options = {}) {
  if (!isWebUsbSupported()) throw new Error('WebUSB is not supported in this browser.');
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let device = options.device || null;   // chosen earlier, inside the click (S3c, S2-Q2: see chooseEmbosserTarget)
  if (!device) {
    const picked = await requestUsbDevice(options);
    if (picked.cancelled) return { success: false, method: 'cancelled', message: picked.message };
    device = picked.device;
  }

  await device.open();
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  let iface = device.configurations[0].interfaces.find(i =>
    i.alternates.some(a => a.interfaceClass === 7)
  ) || device.configurations[0].interfaces[0];

  const ifaceNum = iface.interfaceNumber;
  await device.claimInterface(ifaceNum);

  const alternate = iface.alternates[0];
  const outEndpoint = alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk') || alternate.endpoints.find(e => e.direction === 'out');
  if (!outEndpoint) {
    await device.releaseInterface(ifaceNum);
    await device.close();
    throw new Error('No writable USB endpoint found on this embosser.');
  }

  const epNum = outEndpoint.endpointNumber;
  const data = new TextEncoder().encode(formattedStream);

  onStatus(say(options, 'usb_streaming', "Streaming data directly to the USB embosser…", {}));
  const chunkSize = 512;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize);
    await device.transferOut(epNum, chunk);
    onStatus(say(options, 'sent', "Sent {sent} / {bytes} bytes…", { sent: Math.min(offset + chunkSize, data.length), bytes: data.length }));
    if (offset + chunkSize < data.length) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  await device.releaseInterface(ifaceNum);
  await device.close();
  onStatus(say(options, 'usb_done', "Emboss job sent via WebUSB!", {}));
  return { success: true, method: 'web-usb', message: say(options, 'usb_success', "Sent {bytes} bytes via WebUSB.", { bytes: data.length }) };
}

/** Asks the browser for the serial port of the embosser: the one already allowed, if there is exactly one that is free, else the chooser.
 *  Must run inside the user's click. { port }; a cancelled chooser throws NotFoundError (as requestPort does). */
export async function requestSerialPort(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const authorizedPorts = await navigator.serial.getPorts().catch(() => []);
  if (authorizedPorts.length === 1 && !authorizedPorts[0].readable) return { port: authorizedPorts[0] };
  onStatus(say(options, 'serial_select', "Please select your connected embosser in the browser prompt…", {}));
  return { port: await navigator.serial.requestPort() };
}

/**
 * Direct hardware spooling via WebSerial API.
 */
export async function spoolViaWebSerial(formattedStream, options = {}) {
  if (!isWebSerialSupported()) throw new Error('WebSerial is not supported in this browser.');
  const baudRate = Number(options.baudRate) || 9600;
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let port = null;
  let writer = null;
  try {
    port = options.port || null;   // chosen earlier, inside the click (S3c, S2-Q2: see chooseEmbosserTarget)
    if (!port) {
      const picked = await requestSerialPort(options);
      port = picked.port;
    }
    try {
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'hardware' });
    } catch {
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
    }
    onStatus(say(options, 'serial_connected', "Connected to the embosser at {baud} baud. Sending the braille job…", { baud: baudRate }));

    const data = new TextEncoder().encode(formattedStream);
    writer = port.writable.getWriter();

    const chunkSize = 512;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, offset + chunkSize);
      await writer.write(chunk);
      onStatus(say(options, 'sent', "Sent {sent} / {bytes} bytes…", { sent: Math.min(offset + chunkSize, data.length), bytes: data.length }));
      if (offset + chunkSize < data.length) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }

    writer.releaseLock();
    await port.close();
    onStatus(say(options, 'serial_done', "Emboss job sent!", {}));
    return { success: true, method: 'web-serial', message: say(options, 'serial_success', "Sent {bytes} bytes to the embosser.", { bytes: data.length }) };
  } catch (err) {
    if (writer) { try { writer.releaseLock(); } catch (_) {} }
    if (port && port.close) { try { await port.close(); } catch (_) {} }
    if (err.name === 'NotFoundError' || (err.message && err.message.includes('No port selected'))) {
      return { success: false, method: 'cancelled', message: say(options, 'serial_cancelled', "Embosser port selection was cancelled.", {}) };
    }
    const wrapped = new Error(`Embosser hardware communication error: ${err.message}`);
    wrapped.cause = err;   // S3c: the dispatcher below reads the original error's name (a lost device is a NetworkError)
    throw wrapped;
  }
}

/**
 * Sends the braille payload to a network-connected embosser (HTTP REST /api/print or raw IP bridge).
 */
export async function spoolToNetworkEmbosser(brfText, options = {}) {
  if (!brfText) throw new Error('No braille text provided to spool.');
  const host = (options.host || options.networkHost || '127.0.0.1').trim();
  const port = Number(options.port || options.networkPort) || 9100;
  const path = options.path || (port === 80 || port === 8080 ? '/api/print' : '/');
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const formattedStream = prepareEmbosserStream(brfText, options);
  const url = `http://${host}:${port}${path}`;

  onStatus(say(options, 'network_connecting', "Connecting to the network embosser at {host}:{port}…", { host, port }));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: formattedStream,
      mode: 'cors'
    });
    if (!res.ok) {
      const message = say(options, 'network_rejected', "The network embosser at {url} rejected the job (HTTP {status}).", { url, status: res.status });
      onStatus(message);
      return { success: false, method: 'network-failed', status: res.status, message };
    }
    const message = say(options, 'network_success', "Sent {bytes} bytes to the network embosser at {url} (HTTP {status}).", { bytes: formattedStream.length, url, status: res.status });
    onStatus(message);
    return { success: true, method: 'network-ip', status: res.status, message };
  } catch (err) {
    const message = say(options, 'network_unreachable', "Could not reach {url}: {message}. Browsers cannot open raw TCP (port 9100) connections; the embosser must accept HTTP POST, or download the .brf and send it with your print manager.", { url, message: err && err.message ? err.message : String(err) });
    onStatus(message);
    return { success: false, method: 'network-failed', message };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// S3c (audit 15 Oct 2026, #22 and S2-Q2): the four connection choices of Settings made real, end to end.
//
//   1. connectionSupport(type)   - can this browser do it at all? (Safari and Firefox have no WebSerial, WebHID or Web Bluetooth.)
//   2. chooseEmbosserTarget()    - asks the browser for the port / device FIRST. The chooser is allowed only soon after a click,
//                                  and a long wait for the braille of a big book makes the browser forget the click, so the
//                                  caller asks for the device inside the click, then waits for the braille, then sends.
//   3. sendToEmbosserTarget()    - sends the braille to what was chosen, with the sender for that connection type.
//
// Every failure comes back as { ok:false } / { success:false } with a plain message; nothing here throws for a device problem.
// Senders: serial = WebSerial (WebUSB when the browser has no WebSerial), hid = WebHID, ble = Web Bluetooth, network = HTTP POST.
// None of this has been run against a real embosser (see EMBOSS-TASKS.md S3c).
// ---------------------------------------------------------------------------------------------------------------------------
export const CONNECTION_TYPES = ['serial', 'hid', 'ble', 'network'];
const MODE_FALLBACK_NAME = { serial: 'USB serial', hid: 'USB HID', ble: 'Bluetooth', network: 'Network' };
const modeName = (type, options) => say(options, `mode_${type}`, MODE_FALLBACK_NAME[type] || type, {});

/** Can this browser use the connection type? { ok, short, message } - short: the reason beside the choice in Settings. */
export function connectionSupport(type, options = {}) {
  const nav = globalThis.navigator;
  const has = type === 'serial' ? Boolean(nav?.serial || nav?.usb)
    : type === 'hid' ? Boolean(nav?.hid)
    : type === 'ble' ? Boolean(nav?.bluetooth)
    : true;
  if (has) return { ok: true, short: '', message: '' };
  return {
    ok: false,
    short: say(options, 'unavailable_short', 'Not available in this browser — use Chrome or Edge', {}),
    message: say(options, 'unavailable', 'Nothing was sent: {mode} embossing is not available in this browser — use Chrome or Edge. You can download the .brf file and send it with your print manager, or use Network mode in Settings.', { mode: modeName(type, options) }),
  };
}

// A plain sentence for something that went wrong with the device. stage: 'choose' | 'send'
export function describeEmbosserError(type, err, stage, options = {}) {
  const name = (err && (err.cause?.name || err.name)) || '';
  const raw = String((err && (err.cause?.message || err.message)) || err || '');
  const mode = modeName(type, options);
  if (stage === 'choose' && (name === 'NotAllowedError' || name === 'SecurityError')) {
    return say(options, 'chooser_refused', 'Nothing was sent: the browser did not allow the {mode} device chooser. Click Emboss again to choose the embosser.', { mode });
  }
  if (/failed to open|unable to open|could not (?:open|connect)|connection attempt failed/i.test(raw)) {
    return say(options, 'open_failed', 'The {mode} embosser could not be opened ({message}). Check that it is switched on and that no other program is using it.', { mode, message: raw.replace(/\.+$/, '') });
  }
  if (name === 'NetworkError' || name === 'InvalidStateError' || /disconnect|device has been lost|connection was lost|no longer|not open/i.test(raw)) {
    return say(options, 'disconnected', 'The {mode} embosser was disconnected while sending. Check the cable or connection, switch the embosser on and try again. The job may be partly printed.', { mode });
  }
  if (stage === 'choose') {
    return say(options, 'choose_failed', 'Nothing was sent: the {mode} device could not be chosen ({message}).', { mode, message: raw.replace(/\.+$/, '') });
  }
  return say(options, 'send_failed', 'The braille could not be sent over {mode}: {message}. The job may be partly printed.', { mode, message: raw.replace(/\.+$/, '') });
}

/**
 * Asks the browser for the device or port of the connection type. Call it INSIDE the click, before any other await.
 * Returns { ok:true, type, via, target } or { ok:false, method:'unsupported'|'cancelled'|'error', message }.
 */
export async function chooseEmbosserTarget(type, options = {}) {
  type = CONNECTION_TYPES.includes(type) ? type : 'serial';
  const sup = connectionSupport(type, options);
  if (!sup.ok) return { ok: false, method: 'unsupported', message: sup.message };
  try {
    if (type === 'network') return { ok: true, type, via: 'network', target: null };
    if (type === 'ble') {
      const r = await requestBluetoothDevice(options);
      return r.cancelled ? { ok: false, method: 'cancelled', message: r.message } : { ok: true, type, via: 'web-bluetooth', target: r.device };
    }
    if (type === 'hid') {
      const r = await requestHidDevice(options);
      return r.cancelled ? { ok: false, method: 'cancelled', message: r.message } : { ok: true, type, via: 'web-hid', target: r.device };
    }
    if (isWebSerialSupported()) {
      const r = await requestSerialPort(options);
      return { ok: true, type, via: 'web-serial', target: r.port };
    }
    const r = await requestUsbDevice(options);
    return r.cancelled ? { ok: false, method: 'cancelled', message: r.message } : { ok: true, type, via: 'web-usb', target: r.device };
  } catch (err) {
    if (err && (err.name === 'NotFoundError' || (err.message && /No port selected|No device selected|User cancelled/i.test(err.message)))) {
      const k = type === 'ble' ? 'ble' : type === 'hid' ? 'hid' : 'serial';
      return { ok: false, method: 'cancelled', message: say(options, `${k}_cancelled`, { ble: 'Bluetooth embosser selection was cancelled.', hid: 'HID device selection was cancelled.', serial: 'Embosser port selection was cancelled.' }[k], {}) };
    }
    return { ok: false, method: 'error', message: describeEmbosserError(type, err, 'choose', options) };
  }
}

/** Sends the braille to what chooseEmbosserTarget returned. Never throws: { success, method, message }. */
export async function sendToEmbosserTarget(brfText, choice, options = {}) {
  if (!brfText) return { success: false, method: 'error', message: say(options, 'nothing_to_send', 'There is no braille to send.', {}) };
  const type = choice?.type || options.connectionType || 'serial';
  try {
    if (type === 'network') return await spoolToNetworkEmbosser(brfText, options);
    const stream = prepareEmbosserStream(brfText, options);
    if (type === 'ble') return await spoolViaWebBluetooth(stream, { ...options, device: choice.target });
    if (type === 'hid') return await spoolViaWebHid(stream, { ...options, device: choice.target });
    if (choice?.via === 'web-usb') return await spoolViaWebUsb(stream, { ...options, device: choice.target });
    return await spoolViaWebSerial(stream, { ...options, port: choice.target });
  } catch (err) {
    return { success: false, method: 'error', message: describeEmbosserError(type, err, 'send', options) };
  }
}


/**
 * Unified direct hardware spooler routing automatically across all connection types:
 * - 'serial': WebSerial USB (with WebUSB fallback)
 * - 'hid': Driverless WebHID USB
 * - 'ble': Web Bluetooth Low Energy
 * - 'network': Network HTTP REST / WebSockets
 */
export async function spoolToEmbosser(brfText, options = {}) {
  if (!brfText) throw new Error('No braille text provided to spool.');
  const connType = options.connectionType || 'serial';
  const formattedStream = prepareEmbosserStream(brfText, options);
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  // 1. Bluetooth Low Energy mode
  if (connType === 'ble') {
    return await spoolViaWebBluetooth(formattedStream, options);
  }

  // 2. WebHID Driverless USB mode
  if (connType === 'hid') {
    return await spoolViaWebHid(formattedStream, options);
  }

  // 3. Network REST / IP mode
  if (connType === 'network') {
    return await spoolToNetworkEmbosser(brfText, options);
  }

  // 4. USB Serial mode (WebSerial with local bridge and WebUSB fallbacks)
  // Check local server bridge first
  try {
    const bridgeUrl = (typeof window !== 'undefined' && window.location.origin) ? `${window.location.origin}/api/emboss-usb` : 'http://localhost:8137/api/emboss-usb';
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: formattedStream,
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        onStatus(data.message || say(options, 'usb_bridge_done', "Emboss job delivered to the USB printer!", {}));
        return { success: true, method: 'local-usb-bridge', message: data.message };
      }
    }
  } catch (_) {}

  if (isWebSerialSupported()) {
    try {
      return await spoolViaWebSerial(formattedStream, options);
    } catch (err) {
      if (isWebUsbSupported()) {
        try {
          return await spoolViaWebUsb(formattedStream, options);
        } catch (_) {}
      }
      throw err;
    }
  }

  if (isWebUsbSupported()) {
    return await spoolViaWebUsb(formattedStream, options);
  }

  throw new Error('Direct USB hardware communication is not supported in this browser. Please use Chrome, Edge, or Opera, or configure Bluetooth or Network mode in Settings.');
}
