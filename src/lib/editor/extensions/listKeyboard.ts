import { Extension, type Editor } from '@tiptap/core';

type ListItemName = 'listItem' | 'taskItem';
type ListContext = { itemName: ListItemName; hasParentItem: boolean };

function listContextAtSelection(editor: Editor): ListContext | null {
  const { $from } = editor.state.selection;
  let itemName: ListItemName | null = null;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name !== 'listItem' && name !== 'taskItem') continue;
    if (!itemName) itemName = name;
    else return { itemName, hasParentItem: true };
  }

  return itemName ? { itemName, hasParentItem: false } : null;
}

function handleListTab(editor: Editor, direction: 'sink' | 'lift'): boolean {
  const context = listContextAtSelection(editor);
  if (!context) return false;

  if (direction === 'sink') editor.commands.sinkListItem(context.itemName);
  else if (context.hasParentItem) editor.commands.liftListItem(context.itemName);

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
