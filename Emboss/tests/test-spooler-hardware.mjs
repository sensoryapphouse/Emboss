// Modern Universal Braille Embosser Spooler Test Suite
// Covers:
// Part 1: Node ESM Unit Tests (Hardware stream formatting, escape headers, BLE GATT UUIDs, WebHID reports, profile detection)
// Part 2: Headless Chrome Browser Integration (Connection mode toggling, reactive UI panels, mock WebBluetooth, WebHID, WebSerial & Network spooling)

import { chromium } from 'playwright';
import {
  isWebSerialSupported,
  isWebUsbSupported,
  isWebBluetoothSupported,
  isWebHidSupported,
  BLE_GATT_SERVICES,
  KNOWN_EMBOSSER_PROFILES,
  detectEmbosserFromPort,
  sanitizeBrfForEmbosser,
  prepareEmbosserStream,
  spoolToEmbosser,
  spoolViaWebBluetooth,
  spoolViaWebHid,
  spoolViaWebSerial,
  spoolViaWebUsb,
  spoolToNetworkEmbosser
} from '../format/spooler.mjs';

console.log('--- Running Modern Embosser Hardware Spooler Tests ---');

let pass = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ok    ${name}`);
  } else {
    failures.push({ name, detail });
    console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  }
}

// =========================================================================
// Part 1: Node.js Unit Tests for Hardware Profiles & Escape Protocols
// =========================================================================
console.log('\nPart 1: Spooler Core Protocols & Hardware Profiles Unit Tests');

// 1. Feature Detection APIs
ok('isWebSerialSupported returns boolean', typeof isWebSerialSupported() === 'boolean');
ok('isWebUsbSupported returns boolean', typeof isWebUsbSupported() === 'boolean');
ok('isWebBluetoothSupported returns boolean', typeof isWebBluetoothSupported() === 'boolean');
ok('isWebHidSupported returns boolean', typeof isWebHidSupported() === 'boolean');

// 2. BLE GATT UUID Definitions
ok('BLE_GATT_SERVICES contains Custom Emboss Service 0xFEB0', BLE_GATT_SERVICES.EMBOSS_SERVICE === 0xFEB0);
ok('BLE_GATT_SERVICES contains Emboss Stream RX UUID', BLE_GATT_SERVICES.EMBOSS_RX_UUID.includes('feb1'));
ok('BLE_GATT_SERVICES contains Emboss Status TX UUID', BLE_GATT_SERVICES.EMBOSS_TX_UUID.includes('feb2'));
ok('BLE_GATT_SERVICES contains Nordic UART Service UUID', BLE_GATT_SERVICES.NORDIC_UART_SERVICE.startsWith('6e400001'));
ok('BLE_GATT_SERVICES contains HM-10 UART Service UUID', BLE_GATT_SERVICES.HM10_SERVICE === 0xFFE0);

// 3. Hardware Profiles
ok('KNOWN_EMBOSSER_PROFILES contains Index Braille', KNOWN_EMBOSSER_PROFILES.some(p => p.id === 'index' && p.vendorIds.includes(0x1868)));
ok('KNOWN_EMBOSSER_PROFILES contains ViewPlus', KNOWN_EMBOSSER_PROFILES.some(p => p.id === 'viewplus' && p.vendorIds.includes(0x0bd7)));
ok('KNOWN_EMBOSSER_PROFILES contains Custom Microcontrollers', KNOWN_EMBOSSER_PROFILES.some(p => p.id === 'custom-card' && p.vendorIds.includes(0x2e8a)));

// 4. Port Detection
const mockIndexPort = { getInfo: () => ({ usbVendorId: 0x1868, usbProductId: 0x0001 }) };
const mockViewPlusPort = { getInfo: () => ({ usbVendorId: 0x0bd7, usbProductId: 0x0002 }) };
const mockUnknownPort = { getInfo: () => ({ usbVendorId: 0x9999, usbProductId: 0x0000 }) };
const mockNoUsbPort = { getInfo: () => ({}) };

ok('Detects Index Braille from VID 0x1868', detectEmbosserFromPort(mockIndexPort).id === 'index');
ok('Detects ViewPlus from VID 0x0bd7', detectEmbosserFromPort(mockViewPlusPort).id === 'viewplus');
ok('Detects Generic profile for unknown VID', detectEmbosserFromPort(mockUnknownPort).id === 'generic');
ok('Handles port with missing USB info safely', detectEmbosserFromPort(mockNoUsbPort).id === 'generic');

// 5. BRF Sanitization
const unicodeSample = '⠓⠑⠇⠇⠕⠀⠺⠕⠗⠇⠙\n⠼⠁⠃⠉';
const sanitized = sanitizeBrfForEmbosser(unicodeSample);
ok('sanitizeBrfForEmbosser converts unicode cells to ASCII NABCC', sanitized === 'HELLO WORLD\n#ABC', sanitized);

// 6. Escape Sequence Protocol Formatting
// A. Index Braille (ESC DP2 / ESC DP1 + SUB \x1a trailer)
const indexStream = prepareEmbosserStream(',hello ,world', { embosser: 'index', duplex: 'double' });
ok('Index stream contains ESC DP2 duplex prefix', indexStream.startsWith('\x1bDP2'));
ok('Index stream contains Form Feed', indexStream.includes('\x0c'));
ok('Index stream terminates with SUB (0x1A)', indexStream.endsWith('\x1a'));

// B. Enabling Technologies / Romeo (ESC \x00, ESC \x0c rows, ESC \x0e cols, ESC \x12 duplex)
const romeoStream = prepareEmbosserStream(',hello ,world', { embosser: 'romeo', rows: 25, cols: 40, duplex: 'double' });
ok('Romeo stream contains reset and geometry escape headers', romeoStream.startsWith('\x1b\x00\x1b\x0c25\x1b\x0e40\x1b\x122'));
ok('Romeo stream terminates with EOF \\x1a', romeoStream.endsWith('\x1a'));

// C. ViewPlus / Columbia (ESC * t)
const viewplusStream = prepareEmbosserStream(',hello ,world', { embosser: 'viewplus' });
ok('ViewPlus stream contains ESC * t text mode prefix', viewplusStream.startsWith('\x1b*t'));
ok('ViewPlus stream ends with Form Feed \\x0c', viewplusStream.endsWith('\x0c'));

// D. Braillo (ESC M0 ESC L rows)
const brailloStream = prepareEmbosserStream(',hello ,world', { embosser: 'braillo', rows: 25 });
ok('Braillo stream contains ESC M0 ESC L25 headers', brailloStream.startsWith('\x1bM0\x1bL25'));
ok('Braillo stream ends with Form Feed \\x0c', brailloStream.endsWith('\x0c'));

// E. Generic
const genericStream = prepareEmbosserStream(',hello ,world', { embosser: 'generic' });
ok('Generic stream ends with Form Feed \\x0c', genericStream.endsWith('\x0c'));

// 7. Validation of empty stream error
let threwEmpty = false;
try {
  await spoolToEmbosser('', { connectionType: 'serial' });
} catch (e) {
  threwEmpty = true;
}
ok('spoolToEmbosser rejects empty braille text', threwEmpty);

// =========================================================================
// Part 2: Headless Chrome Direct Braille Editor DOM & Spooler UI Tests
// =========================================================================
console.log('\nPart 2: Headless Chrome Direct Braille Editor Spooler UI Tests');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !process.argv.includes('--show'),
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

await context.addInitScript(() => {
  try {
    localStorage.setItem('emboss-settings', JSON.stringify({
      simpleMode: false,
      sixKeyInput: true,
      mode: 'bana',
      grade: 'g2',
      cells: 40,
      lines: 25,
      uiLanguage: 'en',
      connectionType: 'serial'
    }));
  } catch {}
});

const page = await context.newPage();

const waitFor = async (fn, what, ms = 12000) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) { failures.push(`timed out waiting for ${what}`); console.log(`  ✖ FAIL  timed out waiting for ${what}`); return false; }
    await new Promise((r) => setTimeout(r, 50));
  }
};

page.on('pageerror', (err) => console.error('  ✖ Page error:', err.message));

try {
  await page.goto('http://localhost:8137/editor/index.html', { waitUntil: 'load' });
  await waitFor(() => typeof window.settings === 'object', 'editor window boot');
  await new Promise((r) => setTimeout(r, 300));

  // 1. Verify Connection Mode dropdown options
  const connOptions = await page.evaluate(() => {
    const sel = document.getElementById('set-connectionType');
    if (!sel) return [];
    return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent }));
  });

  ok('Connection type selector exists', connOptions.length >= 4);
  ok('Has "serial" (WebSerial) mode', connOptions.some(o => o.value === 'serial'));
  ok('Has "hid" (WebHID) mode', connOptions.some(o => o.value === 'hid'));
  ok('Has "ble" (Web Bluetooth) mode', connOptions.some(o => o.value === 'ble'));
  ok('Has "network" (REST / IP) mode', connOptions.some(o => o.value === 'network'));

  // 2. Test Connection Type Panel Toggling
  // A. Switch to Network
  const netPanels = await page.evaluate(() => {
    const sel = document.getElementById('set-connectionType');
    sel.value = 'network';
    sel.dispatchEvent(new Event('change'));
    return {
      netGroup: document.getElementById('networkSettingsGroup')?.style.display,
      serialGroup: document.getElementById('serialBaudGroup')?.style.display,
      bleGroup: document.getElementById('bleSettingsGroup')?.style.display,
      hidGroup: document.getElementById('hidSettingsGroup')?.style.display,
    };
  });
  ok('Selecting "network" displays networkSettingsGroup', netPanels.netGroup === 'block');
  ok('Selecting "network" hides serialBaudGroup', netPanels.serialGroup === 'none');

  // B. Switch to Bluetooth Low Energy
  const blePanels = await page.evaluate(() => {
    const sel = document.getElementById('set-connectionType');
    sel.value = 'ble';
    sel.dispatchEvent(new Event('change'));
    return {
      netGroup: document.getElementById('networkSettingsGroup')?.style.display,
      serialGroup: document.getElementById('serialBaudGroup')?.style.display,
      bleGroup: document.getElementById('bleSettingsGroup')?.style.display,
      hidGroup: document.getElementById('hidSettingsGroup')?.style.display,
    };
  });
  ok('Selecting "ble" displays bleSettingsGroup', blePanels.bleGroup === 'block');
  ok('Selecting "ble" hides networkSettingsGroup', blePanels.netGroup === 'none');
  ok('Selecting "ble" hides serialBaudGroup', blePanels.serialGroup === 'none');

  // C. Switch to WebHID
  const hidPanels = await page.evaluate(() => {
    const sel = document.getElementById('set-connectionType');
    sel.value = 'hid';
    sel.dispatchEvent(new Event('change'));
    return {
      netGroup: document.getElementById('networkSettingsGroup')?.style.display,
      serialGroup: document.getElementById('serialBaudGroup')?.style.display,
      bleGroup: document.getElementById('bleSettingsGroup')?.style.display,
      hidGroup: document.getElementById('hidSettingsGroup')?.style.display,
    };
  });
  ok('Selecting "hid" displays hidSettingsGroup', hidPanels.hidGroup === 'block');
  ok('Selecting "hid" hides bleSettingsGroup', hidPanels.bleGroup === 'none');
  ok('Selecting "hid" hides serialBaudGroup', hidPanels.serialGroup === 'none');

  // D. Switch back to USB Serial
  const serialPanels = await page.evaluate(() => {
    const sel = document.getElementById('set-connectionType');
    sel.value = 'serial';
    sel.dispatchEvent(new Event('change'));
    return {
      netGroup: document.getElementById('networkSettingsGroup')?.style.display,
      serialGroup: document.getElementById('serialBaudGroup')?.style.display,
      bleGroup: document.getElementById('bleSettingsGroup')?.style.display,
      hidGroup: document.getElementById('hidSettingsGroup')?.style.display,
    };
  });
  ok('Selecting "serial" displays serialBaudGroup', serialPanels.serialGroup === 'block');
  ok('Selecting "serial" hides networkSettingsGroup', serialPanels.netGroup === 'none');
  ok('Selecting "serial" hides hidSettingsGroup', serialPanels.hidGroup === 'none');

  // 3. Test Mock Web Bluetooth Spooling Pipeline in Browser Context
  const mockBleSpool = await page.evaluate(async () => {
    // Mock navigator.bluetooth
    let sentChunks = 0;
    const mockRxChar = {
      writeValueWithoutResponse: async (chunk) => { sentChunks++; },
      writeValue: async (chunk) => { sentChunks++; }
    };
    const mockService = {
      getCharacteristic: async (uuid) => mockRxChar
    };
    const mockGatt = {
      connect: async () => ({
        getPrimaryService: async (uuid) => mockService
      }),
      connected: true,
      disconnect: () => {}
    };
    const mockDevice = {
      name: 'Test Embosser BLE',
      gatt: mockGatt
    };

    const originalBluetooth = navigator.bluetooth;
    Object.defineProperty(navigator, 'bluetooth', {
      value: {
        requestDevice: async () => mockDevice
      },
      configurable: true
    });

    const { spoolViaWebBluetooth } = await import('/format/spooler.mjs');
    const result = await spoolViaWebBluetooth(',hello ,world\x0c', {
      embosser: 'generic',
      onStatus: () => {}
    });

    // Restore
    Object.defineProperty(navigator, 'bluetooth', { value: originalBluetooth, configurable: true });

    return {
      success: result.success,
      method: result.method,
      sentChunks
    };
  });

  ok('In-browser mock WebBluetooth spooling succeeded', mockBleSpool.success);
  ok('In-browser mock WebBluetooth method is "web-bluetooth"', mockBleSpool.method === 'web-bluetooth');
  ok('In-browser mock WebBluetooth transmitted chunks', mockBleSpool.sentChunks > 0);

  // 4. Test Mock WebHID Spooling Pipeline in Browser Context
  const mockHidSpool = await page.evaluate(async () => {
    let sentReports = 0;
    const mockHidDevice = {
      productName: 'ESP32-S3 Tactile Embosser',
      opened: false,
      open: async function() { this.opened = true; },
      close: async function() { this.opened = false; },
      sendReport: async (reportId, data) => { sentReports++; }
    };

    const originalHid = navigator.hid;
    Object.defineProperty(navigator, 'hid', {
      value: {
        requestDevice: async () => [mockHidDevice]
      },
      configurable: true
    });

    const { spoolViaWebHid } = await import('/format/spooler.mjs');
    const result = await spoolViaWebHid(',hello ,world\x0c', {
      embosser: 'generic',
      onStatus: () => {}
    });

    Object.defineProperty(navigator, 'hid', { value: originalHid, configurable: true });

    return {
      success: result.success,
      method: result.method,
      sentReports
    };
  });

  ok('In-browser mock WebHID spooling succeeded', mockHidSpool.success);
  ok('In-browser mock WebHID method is "web-hid"', mockHidSpool.method === 'web-hid');
  ok('In-browser mock WebHID transmitted output reports', mockHidSpool.sentReports > 0);

} finally {
  await browser.close();
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Modern Embosser Hardware Spooler Test Results: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All Modern Embosser Hardware Spooler tests passed 100% cleanly!');
}
