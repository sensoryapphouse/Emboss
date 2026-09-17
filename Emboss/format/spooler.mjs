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
    const header = `\x1b\x00\x1b\x0c${rows}\x1b\x0e${cols}\x1b\x12${duplex}`;
    const trailer = '\x1a';
    return header + text + trailer;
  }

  if (m === 'viewplus' || m === 'columbia' || m === 'pixblaster' || m === 'tiger' || m === 'premier' || m === 'embraille') {
    const header = '\x1b*t';
    const trailer = '\x0c';
    return header + text + trailer;
  }

  if (m === 'braillo') {
    const header = `\x1bM0\x1bL${rows}`;
    const trailer = '\x0c';
    return header + text + trailer;
  }

  if (!text.endsWith('\x0c') && !text.endsWith('\x0c\r\n')) {
    text += '\x0c';
  }
  return text;
}

/**
 * Direct wireless hardware spooling via Web Bluetooth (BLE).
 */
export async function spoolViaWebBluetooth(formattedStream, options = {}) {
  if (!isWebBluetoothSupported()) throw new Error('Web Bluetooth is not supported in this browser.');
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  onStatus(say(options, 'ble_select', "Please select your Bluetooth embosser in the browser prompt…", {}));
  let device = null;
  try {
    device = await navigator.bluetooth.requestDevice({
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
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.message && (err.message.includes('User cancelled') || err.message.includes('No device selected')))) {
      return { success: false, method: 'cancelled', message: say(options, 'ble_cancelled', "Bluetooth embosser selection was cancelled.", {}) };
    }
    throw err;
  }

  onStatus(say(options, 'connecting_device', "Connecting to {device}…", { device: device.name || 'Bluetooth' }));
  const server = await device.gatt.connect();

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

/**
 * Direct driverless hardware spooling via WebHID API (Universal USB).
 */
export async function spoolViaWebHid(formattedStream, options = {}) {
  if (!isWebHidSupported()) throw new Error('WebHID is not supported in this browser.');
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
      return { success: false, method: 'cancelled', message: say(options, 'hid_cancelled', "HID device selection was cancelled.", {}) };
    }
    throw err;
  }

  if (!devices || !devices.length) {
    return { success: false, method: 'cancelled', message: say(options, 'hid_none', "No HID embosser selected.", {}) };
  }

  const device = devices[0];
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

/**
 * Direct hardware spooling via WebUSB API.
 */
export async function spoolViaWebUsb(formattedStream, options = {}) {
  if (!isWebUsbSupported()) throw new Error('WebUSB is not supported in this browser.');
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  const filters = [
    { vendorId: 0x1868 },
    { vendorId: 0x11a9 },
    { vendorId: 0x0bd7 },
    { vendorId: 0x2e8a },
  ];

  onStatus(say(options, 'usb_select', "Please select your USB embosser in the browser prompt…", {}));
  let device = null;
  try {
    device = await navigator.usb.requestDevice({ filters });
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.message && err.message.includes('No device selected'))) {
      return { success: false, method: 'cancelled', message: say(options, 'usb_cancelled', "Embosser selection was cancelled.", {}) };
    }
    throw err;
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
    const authorizedPorts = await navigator.serial.getPorts().catch(() => []);
    if (authorizedPorts.length === 1 && !authorizedPorts[0].readable) {
      port = authorizedPorts[0];
    } else {
      onStatus(say(options, 'serial_select', "Please select your connected embosser in the browser prompt…", {}));
      port = await navigator.serial.requestPort();
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
    throw new Error(`Embosser hardware communication error: ${err.message}`);
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
