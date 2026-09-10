import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEmbosserStream, detectEmbosserFromPort, KNOWN_EMBOSSER_PROFILES } from '../format/spooler.mjs';

test('Spooler Protocol: Index Braille V4/V5 & APH PageBlaster Stream Formatting', () => {
  const brf = ' ,CHAPTER #A\r\n\r\n ,THIS IS BRAILLE TEXT.';
  
  // Single-sided
  const streamSimplex = prepareEmbosserStream(brf, { embosser: 'index', width: 40, depth: 25, duplex: 'single' });
  assert.ok(streamSimplex.endsWith('\x1a'), 'Index stream must terminate with ASCII SUB 0x1A');
  assert.ok(streamSimplex.includes('\x0c\x1a'), 'Index stream must include Form Feed before SUB');
  assert.ok(streamSimplex.includes(',CHAPTER #A'));

  // Double-sided (Interpoint)
  const streamDuplex = prepareEmbosserStream(brf, { embosser: 'pageblaster', width: 38, depth: 25, duplex: 'double' });
  assert.ok(streamDuplex.endsWith('\x1a'), 'PageBlaster stream must terminate with ASCII SUB 0x1A');
});

test('Spooler Protocol: Enabling Technologies Romeo & Juliet Escape Sequences', () => {
  const brf = ' ,TESTING ROMEO SPOOLER.\x0c';
  const stream = prepareEmbosserStream(brf, { embosser: 'romeo', width: 40, depth: 25, duplex: 'double' });
  
  assert.ok(stream.startsWith('\x1b\x00\x1b\x0c25\x1b\x0e40\x1b\x122'));
  assert.ok(stream.endsWith('\x1a'), 'Romeo stream must terminate with 0x1A (EOF)');
});

test('Spooler Protocol: ViewPlus Tiger & PixBlaster Text Protocol', () => {
  const brf = ' ,VIEWPLUS TIGER TEST.\x0c';
  const stream = prepareEmbosserStream(brf, { embosser: 'viewplus' });
  
  assert.ok(stream.startsWith('\x1b*t'));
  assert.ok(stream.endsWith('\x0c'));
});

test('Spooler Protocol: Braillo 300/600 Escape Sequences', () => {
  const brf = ' ,BRAILLO TEST.\x0c';
  const stream = prepareEmbosserStream(brf, { embosser: 'braillo', depth: 27 });
  
  assert.ok(stream.startsWith('\x1bM0\x1bL27'));
  assert.ok(stream.endsWith('\x0c'));
});

test('Spooler Protocol: Generic Embosser & Form Feed Ejection', () => {
  const brfNoFF = ' ,GENERIC EMBOSSER TEXT.';
  const stream = prepareEmbosserStream(brfNoFF, { embosser: 'generic' });
  
  assert.ok(stream.endsWith('\x0c'), 'Generic stream must terminate with Form Feed for clean page ejection');
});

test('Spooler Protocol: USB Hardware Device Profile Matching', () => {
  // Index Braille USB
  const indexMockPort = { getInfo: () => ({ usbVendorId: 0x11a9, usbProductId: 0x6001 }) };
  const indexProfile = detectEmbosserFromPort(indexMockPort);
  assert.equal(indexProfile.id, 'index');

  // ViewPlus USB
  const vpMockPort = { getInfo: () => ({ usbVendorId: 0x0bd7, usbProductId: 0x0010 }) };
  const vpProfile = detectEmbosserFromPort(vpMockPort);
  assert.equal(vpProfile.id, 'viewplus');

  // Simple One-Page / MCU USB (Raspberry Pi Pico VID 0x2e8a)
  const picoMockPort = { getInfo: () => ({ usbVendorId: 0x2e8a, usbProductId: 0x0005 }) };
  const picoProfile = detectEmbosserFromPort(picoMockPort);
  assert.equal(picoProfile.id, 'custom-card');

  // Unknown / Generic Serial (Prolific/FTDI generic bridges report as generic)
  const unknownMockPort = { getInfo: () => ({ usbVendorId: 0x9999, usbProductId: 0x9999 }) };
  const genProfile = detectEmbosserFromPort(unknownMockPort);
  assert.equal(genProfile.id, 'generic');
});
