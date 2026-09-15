// Automated AST & Lexical Model Integrity Test Suite for Formatting Across All Styles
import assert from 'node:assert';
import {
  createEditor, $getRoot, ParagraphNode, HeadingNode, ListNode, ListItemNode, TextNode,
  $createHeadingNode, $createListNode, $createListItemNode, $createTextNode,
} from '../web/editor/vendor-lexical.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

const TF = { bold: 4, italic: 1, underline: 2 };

class BanaParagraphNode extends ParagraphNode {
  __banaStyle = null;
  static getType() { return 'paragraph'; }
  static clone(n) { return new BanaParagraphNode(n.__banaStyle, n.__key); }
  constructor(banaStyle = null, key) { super(key); this.__banaStyle = banaStyle || null; }
  getBanaStyle() { return this.getLatest().__banaStyle || null; }
  setBanaStyle(s) { const writable = this.getWritable(); writable.__banaStyle = s || null; return this; }
}

class SidebarNode extends ParagraphNode {
  __title = '';
  static getType() { return 'sidebar'; }
  static clone(n) { return new SidebarNode(n.__title, n.__key); }
  constructor(title = '', key) { super(key); this.__title = title; }
  getTitle() { return this.getLatest().__title || ''; }
  setTitle(t) { const w = this.getWritable(); w.__title = t; return this; }
}

const $isHeadingNode = (n) => n instanceof HeadingNode;
const $isListNode = (n) => n instanceof ListNode;
const $isSidebarNode = (n) => n instanceof SidebarNode;

function nodeToRuns(node) {
  const runs = [];
  let hasEmph = false, hasMath = false;
  for (const child of node.getChildren()) {
    const text = child.getTextContent();
    if (!text) continue;
    let tf = 0;
    if (typeof child.hasFormat === 'function') {
      if (child.hasFormat('bold')) tf |= TF.bold;
      if (child.hasFormat('italic')) tf |= TF.italic;
      if (child.hasFormat('underline')) tf |= TF.underline;
    }
    if (tf) hasEmph = true;
    runs.push({ type: 'text', text, tf });
  }
  return { runs, hasEmph, hasMath };
}

function paraBlock(node) {
  const { runs, hasEmph, hasMath } = nodeToRuns(node);
  if (!runs.length) return null;
  const banaStyle = (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null) || node.__banaStyle || null;
  const block = (hasMath || hasEmph) ? { type: 'para', segments: runs }
    : { type: 'para', text: node.getTextContent().replace(/\s+/g, ' ').trim() };
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') block.type = 'note';
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') block.type = 'footnote';
    else if (banaStyle === 'attribution') block.type = 'attribution';
    else if (banaStyle === 'stage' || banaStyle === 'play-stage') block.type = 'stage';
    else if (banaStyle === 'dialogue' || banaStyle === 'play-speaker' || banaStyle === 'speaker') { block.type = 'play'; block.subtype = 'prose'; }
    else if (banaStyle === 'verse' || banaStyle === 'poem' || banaStyle === 'play-verse') { block.type = 'play'; block.subtype = 'verse'; }
    else if (banaStyle === 'quote') { block.type = 'para'; block.style = 'quote'; }
  }
  return block;
}

function buildModelFromRoot(root) {
  const blocks = [];
  for (const node of root.getChildren()) {
    if ($isSidebarNode(node)) {
      const innerBlocks = [];
      for (const child of node.getChildren()) {
        if ($isHeadingNode(child)) {
          const { runs, hasEmph, hasMath } = nodeToRuns(child);
          const text = child.getTextContent().replace(/\s+/g, ' ').trim();
          if (runs.length && (hasEmph || hasMath)) {
            innerBlocks.push({ type: 'heading', level: Math.min(3, Number(child.getTag().slice(1)) || 2), segments: runs, text });
          } else if (text) {
            innerBlocks.push({ type: 'heading', level: Math.min(3, Number(child.getTag().slice(1)) || 2), text });
          }
        } else if ($isListNode(child)) {
          const items = [];
          for (const li of child.getChildren()) {
            const { runs, hasEmph, hasMath } = nodeToRuns(li);
            if (!runs.length) continue;
            const item = (hasEmph || hasMath) ? { segments: runs } : { text: li.getTextContent().replace(/\s+/g, ' ').trim() };
            items.push(item);
          }
          if (items.length) innerBlocks.push({ type: 'list', items });
        } else {
          const b = paraBlock(child);
          if (b) innerBlocks.push(b);
        }
      }
      blocks.push({ type: 'box', title: node.getTitle() || undefined, blocks: innerBlocks });
    } else if ($isHeadingNode(node)) {
      const { runs, hasEmph, hasMath } = nodeToRuns(node);
      const text = node.getTextContent().replace(/\s+/g, ' ').trim();
      if (runs.length && (hasEmph || hasMath)) {
        blocks.push({ type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), segments: runs, text });
      } else if (text) {
        blocks.push({ type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), text });
      }
    } else if ($isListNode(node)) {
      const items = [];
      for (const li of node.getChildren()) {
        const { runs, hasEmph, hasMath } = nodeToRuns(li);
        if (!runs.length) continue;
        const item = (hasEmph || hasMath) ? { segments: runs } : { text: li.getTextContent().replace(/\s+/g, ' ').trim() };
        items.push(item);
      }
      if (items.length) blocks.push({ type: 'list', items });
    } else {
      const b = paraBlock(node);
      if (b) blocks.push(b);
    }
  }
  return blocks;
}

(async () => {
  console.log('=== Running Lexical Model & AST Integrity Suite ===\n');

  const editor = createEditor({
    namespace: 'test-emboss',
    nodes: [
      { replace: ParagraphNode, with: () => new BanaParagraphNode(), withKlass: BanaParagraphNode },
      HeadingNode, ListNode, ListItemNode, SidebarNode,
    ],
    onError: (e) => { throw e; },
  });

  // 1. Top-Level Heading with Bold, Italic, Underline
  editor.update(() => {
    const root = $getRoot();
    root.clear();

    const h1 = $createHeadingNode('h1');
    const t1 = $createTextNode('Chapter 1: ');
    const t2 = $createTextNode('Bold Title');
    t2.toggleFormat('bold');
    h1.append(t1, t2);
    root.append(h1);
  }, { discrete: true });

  const model1 = editor.getEditorState().read(() => buildModelFromRoot($getRoot()));
  ok('Top-Level Heading 1 preserves segments with tf=4 (bold)',
    model1.length === 1 && model1[0].type === 'heading' && Array.isArray(model1[0].segments) && model1[0].segments[1].tf === 4,
    JSON.stringify(model1));

  // 2. BANA Paragraph Styles (Note, Footnote, Attribution, Caption, Stage, Dialogue)
  const banaStyles = [
    { style: 'note', expectedType: 'note' },
    { style: 'footnote', expectedType: 'footnote' },
    { style: 'caption', expectedType: 'caption' },
    { style: 'attribution', expectedType: 'attribution' },
    { style: 'stage', expectedType: 'stage' },
    { style: 'dialogue', expectedType: 'play' },
    { style: 'quote', expectedType: 'para' },
  ];

  for (const { style, expectedType } of banaStyles) {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const p = new BanaParagraphNode(style);
      const t1 = $createTextNode('Prefix ');
      const t2 = $createTextNode('ItalicText');
      t2.toggleFormat('italic');
      p.append(t1, t2);
      root.append(p);
    }, { discrete: true });

    const model = editor.getEditorState().read(() => buildModelFromRoot($getRoot()));
    ok(`BANA Style [${style}] produces type='${expectedType}' with preserved segments and tf=1 (italic)`,
      model.length === 1 && model[0].type === expectedType && Array.isArray(model[0].segments) && model[0].segments[1].tf === 1,
      JSON.stringify(model));
  }

  // 3. Nested Sidebar Box with Headings, Lists, and Notes
  editor.update(() => {
    const root = $getRoot();
    root.clear();

    const sidebar = new SidebarNode('Key Concepts');

    const h2 = $createHeadingNode('h2');
    const ht = $createTextNode('Crucial Topic');
    ht.toggleFormat('bold');
    h2.append(ht);

    const list = $createListNode('bullet');
    const li = $createListItemNode();
    const lit = $createTextNode('Underlined bullet');
    lit.toggleFormat('underline');
    li.append(lit);
    list.append(li);

    const note = new BanaParagraphNode('note');
    const nt = $createTextNode('TN with bold');
    nt.toggleFormat('bold');
    note.append(nt);

    sidebar.append(h2, list, note);
    root.append(sidebar);
  }, { discrete: true });

  const model3 = editor.getEditorState().read(() => buildModelFromRoot($getRoot()));
  ok('Sidebar container contains 3 nested blocks',
    model3.length === 1 && model3[0].type === 'box' && model3[0].blocks?.length === 3,
    JSON.stringify(model3));
  ok('Sidebar nested heading retains segments with tf=4 (bold)',
    model3[0]?.blocks?.[0]?.type === 'heading' && model3[0]?.blocks?.[0]?.segments?.[0]?.tf === 4,
    JSON.stringify(model3[0]?.blocks?.[0]));
  ok('Sidebar nested list item retains segments with tf=2 (underline)',
    model3[0]?.blocks?.[1]?.type === 'list' && model3[0]?.blocks?.[1]?.items?.[0]?.segments?.[0]?.tf === 2,
    JSON.stringify(model3[0]?.blocks?.[1]));
  ok('Sidebar nested transcriber note retains segments with tf=4 (bold)',
    model3[0]?.blocks?.[2]?.type === 'note' && model3[0]?.blocks?.[2]?.segments?.[0]?.tf === 4,
    JSON.stringify(model3[0]?.blocks?.[2]));

  console.log(`\n==================================================`);
  console.log(`AST INTEGRITY RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log(`==================================================\n`);
  process.exit(fail ? 1 : 0);
})();
