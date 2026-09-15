// Automated test suite for Step 3A: BANA Style Metadata & Lexical Synchronization.
import assert from 'node:assert';
import { exportToNimasXml } from '../input/nimas-export.mjs';

// We import Lexical core directly
import {
  createEditor, $getRoot, ParagraphNode, HeadingNode, QuoteNode,
  ListNode, ListItemNode
} from '../web/editor/vendor-lexical.mjs';

// Replicate BanaParagraphNode exactly as in editor.mjs
class BanaParagraphNode extends ParagraphNode {
  __banaStyle = null;

  static getType() { return 'paragraph'; }
  static clone(n) {
    const clone = new BanaParagraphNode(n.__banaStyle, n.__key);
    return clone;
  }
  constructor(banaStyle = null, key) {
    super(key);
    this.__banaStyle = banaStyle || null;
  }
  getBanaStyle() {
    return this.getLatest().__banaStyle || null;
  }
  setBanaStyle(s) {
    const writable = this.getWritable();
    writable.__banaStyle = s || null;
    return this;
  }
  createDOM(config) {
    const dom = { classList: new Set(), dataset: {}, tagName: 'P' };
    const style = this.getBanaStyle();
    if (style) {
      dom.classList.add(`bana-style-${style}`);
      dom.dataset.banaStyle = style;
    }
    return dom;
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: 'paragraph',
      version: 1,
      banaStyle: this.getBanaStyle(),
    };
  }
  static importJSON(j) {
    const node = new BanaParagraphNode(j.banaStyle);
    if (j.format !== undefined) node.setFormat(j.format);
    if (j.indent !== undefined) node.setIndent(j.indent);
    if (j.direction !== undefined) node.setDirection(j.direction);
    return node;
  }
}

function getBlockBanaStyle(b) {
  if (!b) return null;
  if (b.style) return b.style;
  if (b.type === 'note' || b.kind === 'tabletn' || b.kind === 'image') return 'note';
  if (b.type === 'caption') return 'caption';
  if (b.type === 'footnote') return 'footnote';
  if (b.type === 'attribution') return 'attribution';
  if (b.type === 'stage') return 'stage';
  if (b.type === 'play') return b.subtype === 'verse' ? 'poem' : 'dialogue';
  return null;
}

function nodeToRuns(node) {
  const runs = [];
  for (const child of node.getChildren()) {
    const text = child.getTextContent();
    if (!text) continue;
    let tf = 0;
    if (typeof child.hasFormat === 'function') {
      if (child.hasFormat('bold')) tf |= 4;
      if (child.hasFormat('italic')) tf |= 1;
      if (child.hasFormat('underline')) tf |= 2;
    }
    runs.push({ type: 'text', text, tf });
  }
  return { runs, hasEmph: runs.some(r => r.tf > 0) };
}

function paraBlock(node) {
  const { runs, hasEmph } = nodeToRuns(node);
  if (!runs.length) return null;
  const banaStyle = (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null) || node.__banaStyle || null;
  const block = hasEmph ? { type: 'para', segments: runs }
    : { type: 'para', text: node.getTextContent().replace(/\s+/g, ' ').trim() };
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') block.type = 'note';
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') block.type = 'footnote';
    else if (banaStyle === 'attribution') block.type = 'attribution';
    else if (banaStyle === 'stage') block.type = 'stage';
    else if (banaStyle === 'dialogue') block.type = 'play';
    else if (banaStyle === 'verse' || banaStyle === 'poem') { block.type = 'play'; block.subtype = 'verse'; }
  }
  return block;
}

function fillFromBlock(parent, b, lex) {
  if (b.segments) {
    for (const s of b.segments) {
      if (s.text) {
        const tn = lex.$createTextNode(s.text);
        if (s.tf & 4) tn.toggleFormat('bold');
        if (s.tf & 1) tn.toggleFormat('italic');
        if (s.tf & 2) tn.toggleFormat('underline');
        parent.append(tn);
      }
    }
  } else if ((b.text ?? '').trim()) {
    parent.append(lex.$createTextNode(b.text.replace(/\s+/g, ' ').trim()));
  }
}

async function runTests() {
  console.log('=== Running Step 3A: BANA Style Metadata & Lexical Sync Tests ===\n');

  const editor = createEditor({
    namespace: 'test-emboss',
    nodes: [
      { replace: ParagraphNode, with: () => new BanaParagraphNode(), withKlass: BanaParagraphNode },
      HeadingNode, QuoteNode, ListNode, ListItemNode,
    ],
  });

  const { $createTextNode, $createHeadingNode } = await import('../web/editor/vendor-lexical.mjs');

  // Test 1: Load styled AST blocks into Lexical
  const testDoc = {
    title: 'Drama and Poetry Test',
    blocks: [
      { type: 'heading', level: 1, text: 'Act I: The Tempest' },
      { type: 'stage', text: 'Enter PROSPERO and MIRANDA.' },
      { type: 'play', text: 'PROSPERO: If by your art, my dearest father, you have put the wild waters in this roar...' },
      { type: 'play', subtype: 'verse', text: 'Full fathom five thy father lies; / Of his bones are coral made;' },
      { type: 'note', text: 'Transcriber Note: Archaic spelling preserved from 1623 First Folio.' },
      { type: 'caption', text: 'Figure 1.1: Engraving of Prospero and Ariel.' },
      { type: 'attribution', text: '— William Shakespeare, 1611' },
      { type: 'footnote', text: '1. Fathom: A unit of length equal to six feet.' },
      { type: 'para', text: 'Standard descriptive prose paragraph following the dramatic scene.' },
    ],
  };

  editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const b of testDoc.blocks) {
      if (b.type === 'heading') {
        const h = $createHeadingNode('h' + b.level);
        fillFromBlock(h, b, { $createTextNode });
        root.append(h);
      } else {
        const style = getBlockBanaStyle(b);
        const p = new BanaParagraphNode(style);
        fillFromBlock(p, b, { $createTextNode });
        root.append(p);
      }
    }
  });

  // Verify Lexical nodes hold their styles
  editor.read(() => {
    const children = $getRoot().getChildren();
    assert.strictEqual(children.length, 9, 'All 9 blocks loaded into Lexical');

    assert.strictEqual(children[1].getBanaStyle(), 'stage');
    assert.strictEqual(children[2].getBanaStyle(), 'dialogue');
    assert.strictEqual(children[3].getBanaStyle(), 'poem');
    assert.strictEqual(children[4].getBanaStyle(), 'note');
    assert.strictEqual(children[5].getBanaStyle(), 'caption');
    assert.strictEqual(children[6].getBanaStyle(), 'attribution');
    assert.strictEqual(children[7].getBanaStyle(), 'footnote');
    assert.strictEqual(children[8].getBanaStyle(), null);
    console.log('  ✓ Lexical nodes hold correct __banaStyle metadata on import');
  });

  // Test 2: Edit text inside Lexical and re-extract AST
  editor.update(() => {
    const children = $getRoot().getChildren();
    // Edit the stage direction text
    const stageNode = children[1];
    const textChild = stageNode.getFirstChild();
    textChild.setTextContent('Enter PROSPERO, MIRANDA, and ARIEL.');

    // Edit the note text
    const noteNode = children[4];
    const noteTextChild = noteNode.getFirstChild();
    noteTextChild.setTextContent('Transcriber Note: Edited note with additional context.');
  });

  // Extract AST from Lexical via paraBlock
  let extractedBlocks = [];
  editor.read(() => {
    for (const node of $getRoot().getChildren()) {
      if (node.getType() === 'heading') {
        extractedBlocks.push({ type: 'heading', level: 1, text: node.getTextContent() });
      } else {
        const b = paraBlock(node);
        if (b) extractedBlocks.push(b);
      }
    }
  });

  assert.strictEqual(extractedBlocks.length, 9);
  assert.strictEqual(extractedBlocks[1].type, 'stage');
  assert.strictEqual(extractedBlocks[1].text, 'Enter PROSPERO, MIRANDA, and ARIEL.');
  assert.strictEqual(extractedBlocks[1].style, 'stage');

  assert.strictEqual(extractedBlocks[2].type, 'play');
  assert.strictEqual(extractedBlocks[2].style, 'dialogue');

  assert.strictEqual(extractedBlocks[3].type, 'play');
  assert.strictEqual(extractedBlocks[3].subtype, 'verse');
  assert.strictEqual(extractedBlocks[3].style, 'poem');

  assert.strictEqual(extractedBlocks[4].type, 'note');
  assert.strictEqual(extractedBlocks[4].text, 'Transcriber Note: Edited note with additional context.');
  assert.strictEqual(extractedBlocks[4].style, 'note');

  assert.strictEqual(extractedBlocks[5].type, 'caption');
  assert.strictEqual(extractedBlocks[5].style, 'caption');

  assert.strictEqual(extractedBlocks[6].type, 'attribution');
  assert.strictEqual(extractedBlocks[6].style, 'attribution');

  assert.strictEqual(extractedBlocks[7].type, 'footnote');
  assert.strictEqual(extractedBlocks[7].style, 'footnote');

  assert.strictEqual(extractedBlocks[8].type, 'para');
  assert.strictEqual(extractedBlocks[8].style, undefined);

  console.log('  ✓ Extracted AST preserves 100% of BANA styles after live text edits');

  // Test 3: Re-export to NIMAS XML and assert DTBook tag mappings
  const xml = exportToNimasXml({ title: 'Drama Test', blocks: extractedBlocks });
  assert(xml.includes('<p class="bai-stage">Enter PROSPERO, MIRANDA, and ARIEL.</p>'), 'Includes <p class="bai-stage">');
  assert(xml.includes('<p class="bai-play">PROSPERO: If by your art'), 'Includes <p class="bai-play">');
  assert(xml.includes('<p class="bai-verse">Full fathom five'), 'Includes <p class="bai-verse">');
  assert(xml.includes('Transcriber Note: Edited note with additional context.</prodnote>'), 'Includes <prodnote>');
  assert(xml.includes('<caption>Figure 1.1: Engraving of Prospero and Ariel.</caption>'), 'Includes <caption>');
  assert(xml.includes('<byline>— William Shakespeare, 1611</byline>'), 'Includes <byline>');
  assert(xml.includes('class="footnote"><p>1. Fathom: A unit of length equal to six feet.</p></note>'), 'Includes <note class="footnote">');

  console.log('  ✓ Re-exported NIMAS XML retains exact DTBook element markup for all BANA styles');

  console.log('\nAll Step 3A style sync tests passed successfully!\n');
}

runTests().catch((e) => {
  console.error('Test Failed:', e);
  process.exit(1);
});
