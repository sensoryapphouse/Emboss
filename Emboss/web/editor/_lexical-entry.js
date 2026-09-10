// esbuild entry: re-export the Lexical vanilla-core APIs the prototype needs,
// bundled into a single browser ESM (web/prototype/vendor-lexical.mjs).
export {
  createEditor, $getRoot, $getSelection, $isRangeSelection,
  $createParagraphNode, $createTextNode, ParagraphNode, TextNode,
  FORMAT_TEXT_COMMAND, DecoratorNode, $insertNodes, $getNodeByKey, $isDecoratorNode,
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
