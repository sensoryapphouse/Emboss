import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVolumes } from '../format/document.mjs';

function mockTranslate(text) {
  if (!text) return '';
  return text.toUpperCase();
}

test('Volume Splitting: Single Volume Default', () => {
  const doc = {
    title: 'Short Story',
    blocks: [
      { type: 'heading', level: 1, text: 'Chapter 1' },
      { type: 'para', text: 'A brief tale fitting on one page.' }
    ]
  };

  const opts = {
    mode: 'ukaaf',
    width: 38,
    depth: 25,
    translate: mockTranslate
  };

  const volumes = formatVolumes(doc, opts);
  assert.equal(volumes.length, 1);
  assert.equal(volumes[0].volume, 1);
  assert.equal(volumes[0].of, 1);
  assert.equal(volumes[0].spineLabel, 'Short Story - VOL 1/1');
  assert.ok(volumes[0].brf.length > 0);
});

test('Volume Splitting: Multi-Volume Partitioning and Spine Labels', () => {
  // Generate a document with 100 paragraphs that will span ~15 pages
  const blocks = [
    { type: 'heading', level: 1, text: 'The Great Novel' }
  ];
  for (let i = 0; i < 80; i++) {
    blocks.push({
      type: 'heading',
      level: 2,
      text: `Chapter ${i + 1}`
    });
    blocks.push({
      type: 'para',
      text: `This is paragraph content for chapter ${i + 1}. It describes the ongoing events in great detail across multiple sentences to fill space.`
    });
  }

  const doc = { title: 'The Great Novel', blocks };
  const opts = {
    mode: 'ukaaf',
    width: 38,
    depth: 25,
    volumePages: 5, // Split every 5 body pages
    translate: mockTranslate
  };

  const volumes = formatVolumes(doc, opts);
  assert.ok(volumes.length >= 3, `Expected at least 3 volumes, got ${volumes.length}`);

  const totalVols = volumes.length;
  volumes.forEach((vol, idx) => {
    assert.equal(vol.volume, idx + 1);
    assert.equal(vol.of, totalVols);
    assert.equal(vol.spineLabel, `The Great Novel - VOL ${idx + 1}/${totalVols}`);
    assert.ok(vol.brf.length > 0);

    const pages = vol.brf.split('\x0c');
    // Each volume should contain its title page + body pages
    assert.ok(pages.length > 1, `Volume ${idx + 1} has insufficient pages`);
  });
});
