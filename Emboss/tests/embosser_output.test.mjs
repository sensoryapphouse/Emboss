// A12 — Hardware output regression tests.
//
// These tests pin down two things so a later change to spooler.mjs or
// tactile-display.mjs cannot silently alter what is sent to real hardware:
//
//   1. The exact byte streams prepareEmbosserStream() produces for each
//      known embosser profile (init sequence, page setup, form feed), as a
//      hex snapshot with a comment on every byte's intended meaning.
//   2. The WebUSB / WebHID / WebBluetooth / WebSerial device filters used by
//      spooler.mjs and tactile-display.mjs, so a future change cannot widen
//      them to "claim any device" without a test failing.
//
// IMPORTANT — what is and is not verified here:
// This suite proves the code is INTERNALLY CONSISTENT (the bytes it emits
// today are the bytes captured below, and the filters are the ones listed
// below). For Enabling Technologies, Braillo and ViewPlus, those bytes were
// re-derived (23 Sep 2026) from APH's shipped `libembosser` driver classes
// (BrailleBlaster), read with javap — not from a manufacturer manual, and
// NOT verified against real hardware. See the A12 row in EMBOSS-TASKS.md.
// Do not read a passing test here as "confirmed correct against the manual".
//
// Index is explicitly OUT OF SCOPE for that re-derivation: Paul decided on
// 23 Sep 2026 that Index's bytes stay exactly as they are, because they are
// confirmed working on a real Index machine — see "Index bytes are
// unchanged" below and Emboss/docs/embosser-protocols.md.
//
// Only these two files may emit bytes to hardware in this codebase:
//   Emboss/format/spooler.mjs        — prepareEmbosserStream, spoolVia*
//   Emboss/format/tactile-display.mjs — TactileDisplayManager.connect

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareEmbosserStream,
  KNOWN_EMBOSSER_PROFILES,
  spoolViaWebUsb,
  spoolViaWebHid,
  spoolViaWebBluetooth,
} from '../format/spooler.mjs';
import { tactileDisplay } from '../format/tactile-display.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toHex(str) {
  return Array.from(str, (c) => '0x' + c.codePointAt(0).toString(16).padStart(2, '0'));
}

// Runs `fn` with globalThis.navigator temporarily replaced by `mockNav`,
// restoring the original descriptor afterwards (Node's built-in `navigator`
// is an accessor with no setter, so a plain assignment silently no-ops —
// defineProperty is required to actually replace it for the module under test).
async function withMockNavigator(mockNav, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: mockNav, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}

// ---------------------------------------------------------------------------
// 1. Exact byte streams per embosser profile
// ---------------------------------------------------------------------------

test('Index (Basic-D / Everest-D): init + form feed, hex snapshot', () => {
  const out = prepareEmbosserStream('ABC', { embosser: 'index', duplex: 'double' });
  assert.deepEqual(toHex(out), [
    '0x1b', '0x44', '0x50', '0x32', // ESC D P 2  — init: "DP" + duplex digit (2 = double-sided)
    '0x41', '0x42', '0x43',         // A B C      — payload (NABCC ASCII braille, unchanged here)
    '0x0c',                         // FF         — form feed / page eject, appended (text had none)
    '0x1a',                         // SUB        — end-of-file marker, always appended
  ]);
});

test('Index: duplex "single" sends digit 1, not 2', () => {
  const out = prepareEmbosserStream('X', { embosser: 'index', duplex: 'single' });
  assert.deepEqual(toHex(out), ['0x1b', '0x44', '0x50', '0x31', '0x58', '0x0c', '0x1a']);
});

test('Index: a body that lands the stream on a 64-byte boundary gets a second SUB', () => {
  // At 58 payload bytes, prefix(4) + payload(58) + appended-FF(1) + SUB(1) = 64 exactly;
  // prepareEmbosserStream's `if (text.length % 64 === 0) text += '\x1a'` then fires,
  // producing a *second* trailing SUB (65 bytes total). One byte short (57) does not.
  const at57 = prepareEmbosserStream('A'.repeat(57), { embosser: 'index', duplex: 'double' });
  const at58 = prepareEmbosserStream('A'.repeat(58), { embosser: 'index', duplex: 'double' });
  assert.equal(at57.length, 63);
  assert.deepEqual(toHex(at57.slice(-2)), ['0x0c', '0x1a']);
  assert.equal(at58.length, 65);
  assert.deepEqual(toHex(at58.slice(-3)), ['0x0c', '0x1a', '0x1a']); // the doubled SUB
});

test('ViewPlus (Columbia / PixBlaster): no header, plain BRF with CR LF FF page ending', () => {
  // BrailleBlaster's ViewPlusEmbosser (libembosser-viewplus-driver-1.4.3.jar) is a
  // graphics/PCL embosser driver (extends BaseGraphicsEmbosser) and writes no raw
  // header or trailer bytes at all — `\x1b*t` was an invented, incomplete PCL
  // fragment and is gone. What's left is plain BRF with the CR LF / CR LF FF
  // convention the other legacy paths below use, since no ViewPlus raw-mode
  // protocol document was found (A12).
  const out = prepareEmbosserStream('ABC', { embosser: 'viewplus' });
  assert.deepEqual(toHex(out), [
    '0x41', '0x42', '0x43', // A B C   — payload, no header
    '0x0d', '0x0a', '0x0c', // CR LF FF — page ending, appended since the text had none
  ]);
});

test('Braillo (200 / 300 / 400 / 600): init + CR LF FF page ending, hex snapshot', () => {
  // Bytes are the literal format string from Braillo200DocumentHandler's private
  // constructor (libembosser-braillo-driver-1.4.3.jar): "\u001bS1\u001bJ0\u001bN0
  // \u001bR0\u001bA%02d\u001bB%02d\u001bC%d\u001bH%d". A/B are ASCII decimal, not
  // binary bytes; C is 1 (interpoint) because duplex defaults to double-sided when
  // not given; H is 0, Braillo200DocumentHandler$Builder's own default (Emboss has
  // no z-fold setting). cols defaults to 40 (not passed here).
  const out = prepareEmbosserStream('ABC', { embosser: 'braillo', rows: 25 });
  assert.deepEqual(toHex(out), [
    '0x1b', '0x53', '0x31',                     // ESC S 1     — fixed reset
    '0x1b', '0x4a', '0x30',                     // ESC J 0     — fixed
    '0x1b', '0x4e', '0x30',                     // ESC N 0     — fixed
    '0x1b', '0x52', '0x30',                     // ESC R 0     — fixed
    '0x1b', '0x41', '0x32', '0x35',             // ESC A 2 5   — rows, ASCII "25" (2-digit decimal)
    '0x1b', '0x42', '0x34', '0x30',             // ESC B 4 0   — cols, ASCII "40" (default, 2-digit decimal)
    '0x1b', '0x43', '0x31',                     // ESC C 1     — interpoint: double-sided (Emboss's default)
    '0x1b', '0x48', '0x30',                     // ESC H 0     — z-fold off (driver's own default)
    '0x41', '0x42', '0x43',                     // A B C       — payload
    '0x0d', '0x0a', '0x0c',                     // CR LF FF    — page ending (AbstractBrailloDocumentHandler)
  ]);
});

test('Romeo / Juliet (Enabling Technologies): letter-command init + CR LF FF page ending, hex snapshot', () => {
  // Bytes are read from EnablingTechnologiesDocumentHandler's private constructor
  // (libembosser-core-drivers-1.4.3.jar) via javap — real letter commands, not the
  // old control-byte guess. R carries leftMargin(0)+cols=40 -> 0x68; T is the fixed
  // pageLength(11in) driver default -> 0x4b; Q carries topMargin(0)+rows=25 -> 0x59
  // (the constructor's bytecode, not the old research guess, decides which letter
  // gets which value — see the comment in spooler.mjs for the full derivation).
  const out = prepareEmbosserStream('ABC', { embosser: 'romeo', rows: 25, width: 40, duplex: 'double' });
  assert.deepEqual(toHex(out), [
    '0x1b', '0x41', '0x40', '0x40',             // ESC A @ @   — fixed opener
    '0x1b', '0x4b', '0x40',                     // ESC K @     — fixed
    '0x1b', '0x57', '0x40',                     // ESC W @     — fixed
    '0x1b', '0x69', '0x40',                     // ESC i @     — duplex: INTERPOINT (double-sided, the default)
    '0x1b', '0x73', '0x40',                     // ESC s @     — cell type: NLS (Emboss has no cell-type setting)
    '0x1b', '0x4c', '0x41',                     // ESC L A     — fixed
    '0x1b', '0x52', '0x68',                     // ESC R h     — leftMargin(0) + cols(40) = 40 -> byte 0x68
    '0x1b', '0x54', '0x4b',                     // ESC T K     — fixed pageLength(11in) driver default -> 0x4b
    '0x1b', '0x51', '0x59',                     // ESC Q Y     — topMargin(0) + rows(25) = 25 -> byte 0x59
    '0x41', '0x42', '0x43',                     // A B C       — payload
    '0x0d', '0x0a', '0x0c',                     // CR LF FF    — page ending (Model.RNF); NO further trailer
                                                 //   (Model.getDocEnd() is empty for Thomas/Juliet/Romeo/ET) —
                                                 //   unlike before, there is no SUB (0x1a) at the end at all.
  ]);
});

test('Index bytes are unchanged (Paul, 23 Sep 2026: Index is confirmed working on a real machine, so it is excluded from the A12 driver correction)', () => {
  // This is a deliberate duplicate of the pin above, not incidental overlap: A12
  // corrected Enabling Technologies, Braillo and ViewPlus against APH's shipped
  // driver classes, and Index was explicitly left alone by Paul's decision — see
  // Emboss/docs/embosser-protocols.md, "Paul's decision (23 Sep 2026)". If a later
  // change to the Index branch of prepareEmbosserStream ever alters these bytes,
  // that decision is being overridden, silently or not, and this test must fail.
  const out = prepareEmbosserStream('ABC', { embosser: 'index', duplex: 'double' });
  assert.deepEqual(toHex(out), [
    '0x1b', '0x44', '0x50', '0x32', // ESC D P 2 — Emboss's existing (unverified-against-driver-too, but
                                     //             working-on-real-hardware) Index init sequence
    '0x41', '0x42', '0x43',         // A B C     — payload
    '0x0c',                         // FF        — form feed
    '0x1a',                         // SUB       — end-of-file marker
  ]);
});

test('Unrecognised / generic model: no header, form feed only', () => {
  const out = prepareEmbosserStream('ABC', { embosser: 'some-unknown-model' });
  assert.deepEqual(toHex(out), ['0x41', '0x42', '0x43', '0x0c']);
});

// ---------------------------------------------------------------------------
// 2. Form-feed counts for a document of known size
// ---------------------------------------------------------------------------

test('a 3-page document produces 3 form feeds for Index / ViewPlus / Braillo / generic', () => {
  const threePages = 'PAGE1\fPAGE2\fPAGE3'; // 2 embedded page breaks -> 3 pages, no trailing FF yet
  for (const model of ['index', 'viewplus', 'braillo', 'some-unknown-model']) {
    const out = prepareEmbosserStream(threePages, { embosser: model, rows: 25, width: 40 });
    const formFeeds = (out.match(/\f/g) || []).length;
    assert.equal(formFeeds, 3, `${model}: expected 3 form feeds (2 embedded + 1 trailing), got ${formFeeds}`);
  }
});

test('ViewPlus / Braillo / Romeo: page ending is idempotent, never doubled (A12 fix)', () => {
  // Before this fix, viewplus and braillo appended their FF trailer unconditionally,
  // so a source that already ended in a form feed got a doubled trailer — locked in
  // by an earlier version of this test as "reported, not fixed". Now that page
  // endings are the driver's CR LF FF sequence (withCrlfFormFeedPages in
  // spooler.mjs), that helper is idempotent: a form feed already preceded by CR LF
  // is left alone, so there is exactly one page ending, never two. Index is
  // untouched and keeps its own (still asymmetric) behaviour — see the Index tests.
  const alreadyTerminated = 'PAGE1\f';
  const alreadyCrlfTerminated = 'PAGE1\r\n\f';
  for (const embosser of ['viewplus', 'braillo', 'romeo']) {
    const out = prepareEmbosserStream(alreadyTerminated, { embosser, rows: 25, width: 40 });
    assert.equal((out.match(/\f/g) || []).length, 1, `${embosser}: bare trailing FF is not doubled`);
    const out2 = prepareEmbosserStream(alreadyCrlfTerminated, { embosser, rows: 25, width: 40 });
    assert.equal((out2.match(/\f/g) || []).length, 1, `${embosser}: CR LF FF-terminated source is not doubled`);
  }
  const indexOut = prepareEmbosserStream(alreadyTerminated, { embosser: 'index' });
  assert.equal((indexOut.match(/\f/g) || []).length, 1, 'index: trailer FF is skipped when already present (unchanged)');
});

test("Romeo's page breaks are CR LF FF, and the job ends with one (no more SUB trailer)", () => {
  const threePages = 'PAGE1\fPAGE2\fPAGE3';
  const out = prepareEmbosserStream(threePages, { embosser: 'romeo', rows: 25, width: 40 });
  // 2 embedded page breaks + 1 final page ending = 3 form feeds, each now preceded
  // by CR LF (Model.RNF), unlike before, where Romeo's bare 0x0c bytes were 2
  // embedded page breaks plus 1 that was actually part of the old (wrong) "ESC FF
  // 25" opcode, not a real page ending.
  assert.equal((out.match(/\f/g) || []).length, 3);
  assert.ok(out.endsWith('\r\n\f'), 'Romeo page ending is CR LF FF');
  assert.ok(!out.endsWith('\x1a'), 'Romeo no longer has a SUB trailer (Model.getDocEnd() is empty)');
});

// ---------------------------------------------------------------------------
// 3. Known-profile vendor id table (spooler.mjs)
// ---------------------------------------------------------------------------

test('KNOWN_EMBOSSER_PROFILES: vendor ids match the A12 audit exactly', () => {
  const byId = Object.fromEntries(KNOWN_EMBOSSER_PROFILES.map((p) => [p.id, p]));

  // Sourced (see EMBOSS-TASKS.md A12 for citations):
  assert.deepEqual(byId.index.vendorIds, [0x11a9, 0x1868]);
  assert.deepEqual(byId.viewplus.vendorIds, [0x0bd7]);
  assert.deepEqual(byId['custom-card'].vendorIds, [0x2e8a, 0x303a, 0x0483, 0x2341]);

  // Known gap, deliberately locked in rather than silently "fixed": Romeo (Enabling
  // Technologies) and Braillo have NO vendor id on file, so they can never be
  // auto-detected over USB/serial today, and autoApply is correctly false for both.
  assert.deepEqual(byId.romeo.vendorIds, []);
  assert.equal(byId.romeo.autoApply, false);
  assert.deepEqual(byId.braillo.vendorIds, []);
  assert.equal(byId.braillo.autoApply, false);

  // Only profiles with a real vendor id are allowed to auto-apply their preset on connect.
  for (const profile of KNOWN_EMBOSSER_PROFILES) {
    if (profile.autoApply) {
      assert.ok(profile.vendorIds.length > 0, `${profile.id}: autoApply requires at least one vendor id`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Device filters actually passed to the browser APIs (not just the table above)
// ---------------------------------------------------------------------------

test('spoolViaWebUsb requests only the known embosser vendor ids', async () => {
  let seenFilters = null;
  await withMockNavigator({ usb: { requestDevice: async (opts) => { seenFilters = opts.filters; throw new Error('cancel'); } } },
    () => spoolViaWebUsb('x').catch(() => {}));
  assert.deepEqual(seenFilters, [
    { vendorId: 0x1868 }, // Index
    { vendorId: 0x11a9 }, // Index
    { vendorId: 0x0bd7 }, // ViewPlus
    { vendorId: 0x2e8a }, // Raspberry Pi RP2040/2350 (custom embosser MCU)
  ]);
});

test('spoolViaWebHid requests only known vendor ids (no unscoped filter)', async () => {
  let seenFilters = null;
  await withMockNavigator({ hid: { requestDevice: async (opts) => { seenFilters = opts.filters; throw new Error('cancel'); } } },
    () => spoolViaWebHid('x').catch(() => {}));
  assert.deepEqual(seenFilters, [
    { vendorId: 0x303a }, // Espressif ESP32-S3
    { vendorId: 0x2e8a }, // Raspberry Pi RP2040/RP2350
    { vendorId: 0x0483 }, // STMicroelectronics
    { vendorId: 0x2341 }, // Arduino
    { vendorId: 0x1868 }, // Index Braille V5
    { vendorId: 0x0bd7 }, // ViewPlus
  ]);
  for (const f of seenFilters) assert.ok('vendorId' in f, 'every WebHID filter must scope by vendorId');
});

test('spoolViaWebBluetooth is opt-in scoped (never acceptAllDevices)', async () => {
  let seenOpts = null;
  await withMockNavigator({ bluetooth: { requestDevice: async (opts) => { seenOpts = opts; throw new Error('cancel'); } } },
    () => spoolViaWebBluetooth('x').catch(() => {}));
  assert.notEqual(seenOpts.acceptAllDevices, true, 'must not claim every nearby Bluetooth device');
  assert.ok(Array.isArray(seenOpts.filters) && seenOpts.filters.length > 0, 'must scope by name/service filters');
});

test('tactileDisplay Bluetooth connect is opt-in scoped (A12 fix: was acceptAllDevices:true)', async () => {
  let seenOpts = null;
  await withMockNavigator({
    bluetooth: {
      // No getDevices, so connect() goes straight to the requestDevice() prompt path.
      requestDevice: async (opts) => { seenOpts = opts; throw new Error('cancel'); },
    },
  }, () => tactileDisplay.connect({ transport: 'bluetooth', target: 'dotpad' }));
  assert.notEqual(seenOpts.acceptAllDevices, true, 'must not claim every nearby Bluetooth device');
  assert.ok(Array.isArray(seenOpts.filters) && seenOpts.filters.length > 0, 'must scope by name/service filters');
});

test('tactileDisplay HID connect scopes by vendor id or the official Braille Display usage page', async () => {
  let seenFilters = null;
  await withMockNavigator({ hid: { requestDevice: async (opts) => { seenFilters = opts.filters; return []; } } },
    () => tactileDisplay.connect({ transport: 'hid', target: 'monarch' }));
  assert.deepEqual(seenFilters, [
    { usagePage: 0x41 },  // USB HID "Braille Display" usage page (USB-IF HUTRR78) — device-class match, not "any device"
    { vendorId: 0x32ac }, // Dot Inc.
    { vendorId: 0x0bd7 }, // HumanWare / ViewPlus
    { vendorId: 0x11a9 }, // Index
    { vendorId: 0x1868 }, // Index V5
  ]);
});

test('tactileDisplay serial connect scopes by vendor+product id and does not fall back to an unfiltered picker (A12 fix)', async () => {
  let callCount = 0;
  let seenFilters = null;
  await withMockNavigator({
    serial: {
      requestPort: async (opts) => {
        callCount++;
        seenFilters = opts && opts.filters;
        const err = new Error('No port selected by the user.');
        err.name = 'NotFoundError';
        throw err;
      },
    },
  }, async () => {
    const res = await tactileDisplay.connect({ transport: 'serial', target: 'dotpad' });
    assert.equal(res.success, false);
  });
  assert.equal(callCount, 1, 'requestPort must be called exactly once — no unfiltered retry');
  assert.deepEqual(seenFilters, [
    { usbVendorId: 0x0403, usbProductId: 0x6010 }, // DotPad FTDI FT2232
    { usbVendorId: 0x0403, usbProductId: 0x6015 }, // DotPad FTDI FT-X
  ]);
});
