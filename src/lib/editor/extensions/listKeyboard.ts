import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

type ListItemName = 'listItem' | 'taskItem';
type ListName = 'bulletList' | 'orderedList' | 'taskList';
type ListContext = {
  itemName: ListItemName;
  itemDepth: number;
  listDepth: number;
  hasParentItem: boolean;
};

const listNames = new Set<ListName>(['bulletList', 'orderedList', 'taskList']);

function isList(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return Boolean(node && listNames.has(node.type.name as ListName));
}

function children(node: ProseMirrorNode): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  node.forEach((child) => result.push(child));
  return result;
}

function listSlice(
  list: ProseMirrorNode,
  items: ProseMirrorNode[],
  skippedItems = 0,
): ProseMirrorNode {
  const attrs =
    list.type.name === 'orderedList' && skippedItems > 0
      ? { ...list.attrs, start: (list.attrs.start ?? 1) + skippedItems }
      : list.attrs;
  return list.type.create(attrs, Fragment.fromArray(items));
}

function canJoinLists(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  if (left.type !== right.type) return false;
  if (left.type.name !== 'orderedList') return true;
  return (
    left.attrs.type === right.attrs.type &&
    (right.attrs.start ?? 1) === (left.attrs.start ?? 1) + left.childCount
  );
}

function joinLists(left: ProseMirrorNode, right: ProseMirrorNode): ProseMirrorNode {
  return left.copy(left.content.append(right.content));
}

function appendNestedList(
  item: ProseMirrorNode,
  list: ProseMirrorNode,
): { item: ProseMirrorNode; movedItemOffset: number } {
  const itemContent = children(item);
  const trailingList = itemContent.at(-1);

  if (isList(trailingList) && canJoinLists(trailingList, list)) {
    const movedItemOffset =
      2 + item.content.size - trailingList.nodeSize + trailingList.content.size;
    itemContent[itemContent.length - 1] = joinLists(trailingList, list);
    return { item: item.copy(Fragment.fromArray(itemContent)), movedItemOffset };
  }

  return {
    item: item.copy(item.content.append(Fragment.from(list))),
    movedItemOffset: item.content.size + 2,
  };
}

function listContextAtSelection(editor: Editor): ListContext | null {
  const { $from } = editor.state.selection;
  let item: { name: ListItemName; depth: number } | null = null;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name !== 'listItem' && name !== 'taskItem') continue;
    if (!item) item = { name, depth };
    else {
      return {
        itemName: item.name,
        itemDepth: item.depth,
        listDepth: item.depth - 1,
        hasParentItem: true,
      };
    }
  }

  return item
    ? {
        itemName: item.name,
        itemDepth: item.depth,
        listDepth: item.depth - 1,
        hasParentItem: false,
      }
    : null;
}

function restoreSelection(
  editor: Editor,
  transaction: Transaction,
  oldItemStart: number,
  newItemStart: number,
): void {
  const offset = editor.state.selection.anchor - oldItemStart;
  const position = Math.max(0, Math.min(transaction.doc.content.size, newItemStart + offset));
  transaction.setSelection(TextSelection.create(transaction.doc, position)).scrollIntoView();
  editor.view.dispatch(transaction);
}

function sinkAcrossListTypes(editor: Editor, context: ListContext): boolean {
  const { state } = editor;
  if (!state.selection.empty) return false;

  const { $from } = state.selection;
  const currentList = $from.node(context.listDepth);
  const currentItem = $from.node(context.itemDepth);
  const currentItemIndex = $from.index(context.listDepth);
  const outerDepth = context.listDepth - 1;
  const currentListIndex = $from.index(outerDepth);
  if (!isList(currentList) || currentItemIndex !== 0 || currentListIndex === 0) return false;

  const outer = $from.node(outerDepth);
  const previousList = outer.child(currentListIndex - 1);
  if (!isList(previousList) || previousList.childCount === 0) return false;

  const previousItems = children(previousList);
  const parentItem = previousItems.at(-1)!;
  const movedList = listSlice(currentList, [currentItem]);
  const nested = appendNestedList(parentItem, movedList);
  if (!parentItem.type.validContent(nested.item.content)) return false;

  previousItems[previousItems.length - 1] = nested.item;
  let updatedPreviousList = listSlice(previousList, previousItems);
  const currentItems = children(currentList);
  const remainingItems = currentItems.slice(1);
  const replacement: ProseMirrorNode[] = [updatedPreviousList];
  let consumedNextList: ProseMirrorNode | null = null;

  if (remainingItems.length > 0) {
    replacement.push(listSlice(currentList, remainingItems, 1));
  } else {
    const nextList =
      currentListIndex + 1 < outer.childCount ? outer.child(currentListIndex + 1) : null;
    if (isList(nextList) && canJoinLists(updatedPreviousList, nextList)) {
      updatedPreviousList = joinLists(updatedPreviousList, nextList);
      replacement[0] = updatedPreviousList;
      consumedNextList = nextList;
    }
  }

  const currentListStart = $from.before(context.listDepth);
  const previousListStart = currentListStart - previousList.nodeSize;
  const replaceEnd = currentListStart + currentList.nodeSize + (consumedNextList?.nodeSize ?? 0);
  const parentItemStart = previousListStart + 1 + previousList.content.size - parentItem.nodeSize;
  const movedItemStart = parentItemStart + nested.movedItemOffset;
  const transaction = state.tr.replaceWith(
    previousListStart,
    replaceEnd,
    Fragment.fromArray(replacement),
  );

  restoreSelection(editor, transaction, $from.before(context.itemDepth), movedItemStart);
  return true;
}

function liftAcrossListTypes(editor: Editor, context: ListContext): boolean {
  const { state } = editor;
  if (!state.selection.empty || !context.hasParentItem || context.listDepth < 3) return false;

  const { $from } = state.selection;
  const currentList = $from.node(context.listDepth);
  const currentItem = $from.node(context.itemDepth);
  const parentItemDepth = context.listDepth - 1;
  const parentListDepth = context.listDepth - 2;
  const parentItem = $from.node(parentItemDepth);
  const parentList = $from.node(parentListDepth);
  if (!isList(currentList) || !isList(parentList) || parentItem.type === currentItem.type) {
    return false;
  }

  const currentListIndex = $from.index(parentItemDepth);
  if (currentListIndex !== parentItem.childCount - 1) return false;

  const currentItems = children(currentList);
  const currentItemIndex = $from.index(context.listDepth);
  const precedingCurrentItems = currentItems.slice(0, currentItemIndex);
  const followingCurrentItems = currentItems.slice(currentItemIndex + 1);
  const parentContent = children(parentItem);

  if (precedingCurrentItems.length > 0) {
    parentContent[parentContent.length - 1] = listSlice(currentList, precedingCurrentItems);
  } else {
    parentContent.pop();
  }
  const updatedParentItem = parentItem.copy(Fragment.fromArray(parentContent));
  if (!parentItem.type.validContent(updatedParentItem.content)) return false;

  let movedItem = currentItem;
  if (followingCurrentItems.length > 0) {
    movedItem = appendNestedList(
      movedItem,
      listSlice(currentList, followingCurrentItems, currentItemIndex + 1),
    ).item;
  }

  const parentItems = children(parentList);
  const parentItemIndex = $from.index(parentListDepth);
  const precedingParentItems = parentItems.slice(0, parentItemIndex);
  precedingParentItems.push(updatedParentItem);
  const followingParentItems = parentItems.slice(parentItemIndex + 1);
  const precedingParentList = listSlice(parentList, precedingParentItems);
  let movedList = listSlice(currentList, [movedItem], currentItemIndex);
  const replacement = [precedingParentList, movedList];
  if (followingParentItems.length > 0) {
    replacement.push(listSlice(parentList, followingParentItems, parentItemIndex + 1));
  }

  const parentListStart = $from.before(parentListDepth);
  let replaceEnd = parentListStart + parentList.nodeSize;
  if (followingParentItems.length === 0) {
    const outerDepth = parentListDepth - 1;
    const outer = $from.node(outerDepth);
    const parentListIndex = $from.index(outerDepth);
    const nextList =
      parentListIndex + 1 < outer.childCount ? outer.child(parentListIndex + 1) : null;
    if (isList(nextList) && canJoinLists(movedList, nextList)) {
      movedList = joinLists(movedList, nextList);
      replacement[1] = movedList;
      replaceEnd += nextList.nodeSize;
    }
  }
  const transaction = state.tr.replaceWith(
    parentListStart,
    replaceEnd,
    Fragment.fromArray(replacement),
  );
  const movedItemStart = parentListStart + precedingParentList.nodeSize + 1;
  restoreSelection(editor, transaction, $from.before(context.itemDepth), movedItemStart);
  return true;
}

function handleListTab(editor: Editor, direction: 'sink' | 'lift'): boolean {
  const context = listContextAtSelection(editor);
  if (!context) return false;

  if (direction === 'sink') {
    if (!editor.commands.sinkListItem(context.itemName)) sinkAcrossListTypes(editor, context);
  } else if (context.hasParentItem) {
    const parentItemName = editor.state.selection.$from.node(context.listDepth - 1).type.name;
    if (parentItemName !== context.itemName) liftAcrossListTypes(editor, context);
    else editor.commands.liftListItem(context.itemName);
  }

  // Keep focus in the editor when the item cannot move any further.
  return true;
}

export const ListKeyboard = Extension.create({
  name: 'listKeyboard',
  priority: 1_000,

  addKeyboardShortcuts() {
    return {
      Tab: () => handleListTab(this.editor, 'sink'),
      'Shift-Tab': () => handleListTab(this.editor, 'lift'),
    };
  },
});
