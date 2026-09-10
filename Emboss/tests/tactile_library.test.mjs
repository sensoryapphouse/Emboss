import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../web/tactile-assets');

test('Tactile Library: index.json and curriculum-index.json integrity', () => {
  const indexPath = path.join(ASSETS_DIR, 'index.json');
  const curriculumPath = path.join(ASSETS_DIR, 'curriculum-index.json');

  assert.ok(fs.existsSync(indexPath), 'index.json exists');
  assert.ok(fs.existsSync(curriculumPath), 'curriculum-index.json exists');

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));

  assert.ok(curriculum.length >= 1400 && curriculum.length <= 1600, `Curriculum index has ${curriculum.length} curated unique symbols`);

  const sample = curriculum.find(s => s.name.toLowerCase() === 'decagon') || index.find(s => s.name.toLowerCase() === 'decagon');
  assert.ok(sample, 'Decagon found in index');
});

test('Tactile Library: curated symbol catalog integrity', () => {
  const catalogPath = path.resolve(__dirname, '../web/tactile-symbols-catalog.json');
  assert.ok(fs.existsSync(catalogPath), 'tactile-symbols-catalog.json exists');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.ok(catalog.length >= 400, `Curated catalog has ${catalog.length} symbols (>= 400)`);
  assert.ok(catalog[0].id && catalog[0].name && catalog[0].category, 'Catalog entry has id, name, and category');
});

test('Tactile Library: master ZIP archive exists and is non-empty', () => {
  const zipPath = path.join(ASSETS_DIR, 'tactile-library.zip');
  assert.ok(fs.existsSync(zipPath), 'tactile-library.zip exists');
  const stats = fs.statSync(zipPath);
  assert.ok(stats.size > 10 * 1024 * 1024, `ZIP archive is ${stats.size} bytes (> 10MB)`);
});
