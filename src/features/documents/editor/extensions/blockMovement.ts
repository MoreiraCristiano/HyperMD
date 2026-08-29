import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';

type Direction = -1 | 1;

type SiblingRange = {
  parent: ProseMirrorNode;
  parentStart: number;
  startIndex: number;
  endIndex: number;
  from: number;
  to: number;
};

type ListEntry = {
  parent: ProseMirrorNode;
  parentStart: number;
  itemIndex: number;
};

function offsetAtIndex(parent: ProseMirrorNode, index: number): number {
  let offset = 0;
  for (let current = 0; current < index; current += 1) offset += parent.child(current).nodeSize;
  return offset;
}

function listEntriesAt(position: ResolvedPos): ListEntry[] {
  const entries: ListEntry[] = [];

  for (let depth = position.depth; depth > 0; depth -= 1) {
    const name = position.node(depth).type.name;
    if (name !== 'listItem' && name !== 'taskItem') continue;

    const parentDepth = depth - 1;
    entries.push({
      parent: position.node(parentDepth),
      parentStart: position.start(parentDepth),
      itemIndex: position.index(parentDepth),
    });
  }

  return entries;
}

function createRange(
  parent: ProseMirrorNode,
  parentStart: number,
  startIndex: number,
  endIndex: number,
): SiblingRange {
  const from = parentStart + offsetAtIndex(parent, startIndex);
  const to = parentStart + offsetAtIndex(parent, endIndex);
  return { parent, parentStart, startIndex, endIndex, from, to };
}

function selectedSiblingRange(editor: Editor): SiblingRange | null {
  const { doc, selection } = editor.state;
  if (doc.childCount === 0) return null;

  const endPosition = selection.empty
    ? selection.$to
    : doc.resolve(Math.max(selection.from, selection.to - 1));
  const startEntries = listEntriesAt(selection.$from);
  const endEntries = listEntriesAt(endPosition);

  for (const start of startEntries) {
    const end = endEntries.find(
      (candidate) =>
        candidate.parent === start.parent && candidate.parentStart === start.parentStart,
    );
    if (!end) continue;

    return createRange(
      start.parent,
      start.parentStart,
      Math.min(start.itemIndex, end.itemIndex),
      Math.max(start.itemIndex, end.itemIndex) + 1,
    );
  }

  const startIndex = selection.$from.index(0);
  const endIndex = endPosition.index(0) + 1;
  return createRange(doc, 0, startIndex, endIndex);
}

function moveSelection(editor: Editor, direction: Direction): boolean {
  const range = selectedSiblingRange(editor);
  if (!range) return false;
  if (direction < 0 && range.startIndex === 0) return true;
  if (direction > 0 && range.endIndex === range.parent.childCount) return true;

  const { selection } = editor.state;
  const selected = range.parent.content.cut(
    range.from - range.parentStart,
    range.to - range.parentStart,
  );
  const adjacentIndex = direction < 0 ? range.startIndex - 1 : range.endIndex;
  const adjacent = Fragment.from(range.parent.child(adjacentIndex));
  const adjacentSize = adjacent.size;
  const replaceFrom = direction < 0 ? range.from - adjacentSize : range.from;
  const replaceTo = direction < 0 ? range.to : range.to + adjacentSize;
  const movedFrom = direction < 0 ? replaceFrom : range.from + adjacentSize;
  const replacement = direction < 0 ? selected.append(adjacent) : adjacent.append(selected);
  const anchor = movedFrom + (selection.anchor - range.from);
  const head = movedFrom + (selection.head - range.from);
  const transaction = editor.state.tr.replaceWith(replaceFrom, replaceTo, replacement);

  if (selection instanceof TextSelection) {
    transaction.setSelection(
      TextSelection.between(transaction.doc.resolve(anchor), transaction.doc.resolve(head)),
    );
  } else if (selection instanceof NodeSelection) {
    transaction.setSelection(NodeSelection.create(transaction.doc, anchor));
  } else {
    transaction.setSelection(Selection.near(transaction.doc.resolve(head)));
  }

  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export const BlockMovement = Extension.create({
  name: 'blockMovement',
  priority: 1_000,

  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveSelection(this.editor, -1),
      'Alt-ArrowDown': () => moveSelection(this.editor, 1),
    };
  },
});
