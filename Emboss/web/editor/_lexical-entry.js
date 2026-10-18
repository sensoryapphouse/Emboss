// esbuild entry: re-export the Lexical vanilla-core APIs the prototype needs,
// bundled into a single browser ESM (web/editor/vendor-lexical.mjs). Rebuild from the repo root with
// (the .bin/esbuild wrapper is the wrong architecture on this machine; es2020 matches the shipped build):
//   node_modules/@esbuild/darwin-arm64/bin/esbuild Emboss/web/editor/_lexical-entry.js --bundle --format=esm --minify --target=es2020 --outfile=Emboss/web/editor/vendor-lexical.mjs
export {
  createEditor, $getRoot, $getSelection, $isRangeSelection,
  $createParagraphNode, $createTextNode, ParagraphNode, TextNode,
  FORMAT_TEXT_COMMAND, DecoratorNode, ElementNode, $insertNodes, $getNodeByKey, $isDecoratorNode,
  $applyNodeReplacement, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, COMMAND_PRIORITY_HIGH,
  // A69: arm a content decorator (table/image/graphic/equation) as a NodeSelection on the first
  // Backspace/Delete at its boundary, instead of Lexical's default silent removal -- $setSelection
  // to make the NodeSelection active, $createNodeSelection/$isNodeSelection to build and detect it
  // (editor.mjs, the KEY_BACKSPACE_COMMAND/KEY_DELETE_COMMAND handler).
  $setSelection, $createNodeSelection, $isNodeSelection,
} from 'lexical';
export { $insertNodeToNearestRoot, mergeRegister } from '@lexical/utils';
export {
  registerRichText, HeadingNode, QuoteNode, $createHeadingNode, $isHeadingNode,
} from '@lexical/rich-text';
export {
  ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND, registerList, $isListNode, $isListItemNode,
  $createListNode, $createListItemNode,
} from '@lexical/list';
export { $setBlocksType } from '@lexical/selection';
// A89 step 3 (random-action testing, 2 Oct): Emboss runs a paste itself so that, if Lexical's own rich-text paste fails (it threw
// "Expected node to have a parent" pasting formatted text at the start of a heading), the plain text is pasted instead of nothing.
export { PASTE_COMMAND } from 'lexical';
export { $insertDataTransferForRichText } from '@lexical/clipboard';
