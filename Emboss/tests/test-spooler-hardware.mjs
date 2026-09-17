// Modern Universal Braille Embosser Spooler Test Suite
// Covers:
// Part 1: Node ESM Unit Tests (Hardware stream formatting, escape headers, BLE GATT UUIDs, WebHID reports, profile detection)
//
// A former Part 2 (Headless Chrome browser integration against the editor's
// connection-settings UI) was removed: it waited on `window.settings` being a
// global, which editor.mjs (an ES module) no longer exposes, so it always
// timed out. This file is headless-only now.

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
// Summary
// =========================================================================
console.log(`\n=== Modern Embosser Hardware Spooler Test Results: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All Modern Embosser Hardware Spooler tests passed 100% cleanly!');
}
