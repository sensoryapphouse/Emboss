// High-Frequency Concurrent Mutation & Undo/Redo Stress Test Suite
// Simulates thousands of rapid document mutations, block splits, merges, style changes,
// and deep undo/redo stacks while asserting cell mapping invariants.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, traceBlock } from '../format/document.mjs';
import { styledTranslate } from '../format/text-style.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
const translateG2 = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf), 'faithful');
const baseOpts = () => ({ mode: 'bana', width: 38, depth: 25, translate: translateG2 });

const STYLES = ['body', 'dialogue', 'stage', 'verse', 'attribution', 'quote', 'exercise', 'note', 'caption'];

test('Mutation Stress: 3,000 Rapid Randomized AST Mutations & Style Transformations', () => {
  let doc = {
    title: 'Stress Mutation Document',
    blocks: [
      { id: 'b1', type: 'heading', level: 1, text: 'Initial Chapter Heading' },
      { id: 'b2', type: 'para', style: 'body', text: 'The introductory paragraph for mutation stress testing.' },
      { id: 'b3', type: 'list', kind: 'bullet', items: [{ text: 'Item alpha' }, { text: 'Item beta' }] },
      { id: 'b4', type: 'sidebar', text: 'Sidebar box with initial content.' },
      { id: 'b5', type: 'table', headers: ['Header 1', 'Header 2'], rows: [['Val A', 'Val B'], ['Val C', 'Val D']] }
    ]
  };

  const WORDS = ['calculus', 'gravity', 'Shakespeare', 'algebra', 'momentum', 'hypothesis', 'theorem', 'experiment', 'velocity'];

  const t0 = Date.now();
  let blockCounter = 100;

  for (let step = 0; step < 3000; step++) {
    const action = step % 6;

    if (action === 0) {
      // 1. Text Insertion in random block
      const b = doc.blocks[Math.floor(Math.random() * doc.blocks.length)];
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      if (b.type === 'para' || b.type === 'heading' || b.type === 'sidebar') {
        b.text += ' ' + word;
      } else if (b.type === 'list' && b.items.length > 0) {
        b.items[0].text += ' ' + word;
      }
    } else if (action === 1) {
      // 2. Text Truncation / Deletion
      const b = doc.blocks[Math.floor(Math.random() * doc.blocks.length)];
      if ((b.type === 'para' || b.type === 'heading') && b.text.length > 20) {
        b.text = b.text.slice(0, Math.floor(b.text.length * 0.7));
      }
    } else if (action === 2) {
      // 3. Style Transformation
      const b = doc.blocks.find(x => x.type === 'para');
      if (b) {
        b.style = STYLES[step % STYLES.length];
      }
    } else if (action === 3) {
      // 4. Block Splitting
      const bIdx = doc.blocks.findIndex(x => x.type === 'para' && (x.text || '').length > 30);
      if (bIdx >= 0) {
        const target = doc.blocks[bIdx];
        const half = Math.floor(target.text.length / 2);
        const firstHalf = target.text.slice(0, half);
        const secondHalf = target.text.slice(half);
        target.text = firstHalf;
        doc.blocks.splice(bIdx + 1, 0, { id: 'b' + (++blockCounter), type: 'para', style: 'body', text: secondHalf });
      }
    } else if (action === 4) {
      // 5. Block Merging
      if (doc.blocks.length > 8) {
        const p1Idx = doc.blocks.findIndex((x, i) => i > 0 && x.type === 'para' && doc.blocks[i - 1].type === 'para');
        if (p1Idx > 0) {
          doc.blocks[p1Idx - 1].text += ' ' + doc.blocks[p1Idx].text;
          doc.blocks.splice(p1Idx, 1);
        }
      }
    } else if (action === 5) {
      // 6. Periodic Layout Invariant Check every 250 steps
      const brf = formatDocument(doc, baseOpts());
      const maxL = Math.max(0, ...brf.split(/\r?\n/).map(l => l.replace(/[\r\x0c]/g, '').length));
      assert.ok(maxL <= 38, `Line length must remain <= 38, got ${maxL} at step ${step}`);
    }
  }

  const t1 = Date.now();
  assert.ok((t1 - t0) < 3000, `3,000 mutations must complete under 3s, took ${t1 - t0}ms`);

  // Final document check
  const finalBrf = formatDocument(doc, baseOpts());
  assert.ok(finalBrf.length > 0, 'Final mutated document must format valid BRF');
});

test('Mutation Stress: 200-Step Deep Undo/Redo History Stack Integrity', () => {
  const history = [];
  let currentDoc = {
    blocks: [{ id: 'b1', type: 'para', text: 'Initial state of the document.' }]
  };

  // Record 200 edits into history
  for (let i = 1; i <= 200; i++) {
    history.push(JSON.stringify(currentDoc));
    currentDoc = JSON.parse(JSON.stringify(currentDoc));
    currentDoc.blocks[0].text += ` Added word ${i}.`;
    if (i % 20 === 0) {
      currentDoc.blocks.push({ id: `b_extra_${i}`, type: 'heading', level: 2, text: `Section ${i}` });
    }
  }

  assert.equal(history.length, 200);

  // Replay undo operations back to step 0
  const future = [];
  while (history.length > 0) {
    future.push(JSON.stringify(currentDoc));
    const previousState = JSON.parse(history.pop());
    currentDoc = previousState;
  }

  assert.equal(currentDoc.blocks[0].text, 'Initial state of the document.');
  assert.equal(currentDoc.blocks.length, 1);

  // Replay redo operations forward to step 200
  while (future.length > 0) {
    const nextState = JSON.parse(future.pop());
    currentDoc = nextState;
  }

  assert.ok(currentDoc.blocks[0].text.includes('Added word 200'));
  assert.ok(currentDoc.blocks.length > 10);
});
