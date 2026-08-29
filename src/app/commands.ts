export type AppCommandContext = 'always' | 'activeTab' | 'markdown';

export type AppCommandId =
  | 'file.new'
  | 'file.open'
  | 'file.openFolder'
  | 'file.save'
  | 'file.saveAs'
  | 'file.closeTab'
  | 'file.exit'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.selectAll'
  | 'edit.find'
  | 'insert.table'
  | 'tabs.next'
  | 'tabs.previous'
  | 'view.toggleSidebar'
  | 'view.explorer'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.resetZoom'
  | 'preferences.settings'
  | 'preferences.keyboardShortcuts';

export type AppCommand = {
  id: AppCommandId;
  category: string;
  label: string;
  description: string;
  shortcuts?: readonly string[];
  keywords?: readonly string[];
  context?: AppCommandContext;
};

export type ShortcutEntry = {
  category: string;
  label: string;
  shortcut: string;
  description: string;
  when?: string;
};

export const appCommands: readonly AppCommand[] = [
  {
    id: 'file.new',
    category: 'File',
    label: 'New File',
    description: 'Create a new Markdown document.',
    shortcuts: ['Ctrl+N'],
    keywords: ['document', 'markdown'],
  },
  {
    id: 'file.open',
    category: 'File',
    label: 'Open File…',
    description: 'Open a Markdown file from disk.',
    shortcuts: ['Ctrl+O'],
    keywords: ['markdown', 'document'],
  },
  {
    id: 'file.openFolder',
    category: 'File',
    label: 'Open Folder…',
    description: 'Select the workspace shown in Explorer.',
    keywords: ['workspace', 'project'],
  },
  {
    id: 'file.save',
    category: 'File',
    label: 'Save',
    description: 'Save the active Markdown document.',
    shortcuts: ['Ctrl+S'],
    context: 'markdown',
  },
  {
    id: 'file.saveAs',
    category: 'File',
    label: 'Save As…',
    description: 'Save the active document to another path.',
    shortcuts: ['Ctrl+Shift+S'],
    context: 'markdown',
  },
  {
    id: 'file.closeTab',
    category: 'File',
    label: 'Close Tab',
    description: 'Close the active tab, confirming unsaved changes.',
    shortcuts: ['Ctrl+W'],
    context: 'activeTab',
  },
  {
    id: 'file.exit',
    category: 'File',
    label: 'Exit',
    description: 'Close HyperMD, confirming unsaved documents.',
  },
  {
    id: 'edit.undo',
    category: 'Edit',
    label: 'Undo',
    description: 'Undo the last edit in the active document.',
    shortcuts: ['Ctrl+Z'],
    context: 'markdown',
  },
  {
    id: 'edit.redo',
    category: 'Edit',
    label: 'Redo',
    description: 'Redo the last undone edit.',
    shortcuts: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    context: 'markdown',
  },
  {
    id: 'edit.cut',
    category: 'Edit',
    label: 'Cut',
    description: 'Cut the selected content.',
    shortcuts: ['Ctrl+X'],
    context: 'markdown',
  },
  {
    id: 'edit.copy',
    category: 'Edit',
    label: 'Copy',
    description: 'Copy the selected content.',
    shortcuts: ['Ctrl+C'],
    context: 'markdown',
  },
  {
    id: 'edit.paste',
    category: 'Edit',
    label: 'Paste',
    description: 'Paste clipboard content into the document.',
    shortcuts: ['Ctrl+V'],
    context: 'markdown',
  },
  {
    id: 'edit.selectAll',
    category: 'Edit',
    label: 'Select All',
    description: 'Select all content in the active document.',
    shortcuts: ['Ctrl+A'],
    context: 'markdown',
  },
  {
    id: 'edit.find',
    category: 'Edit',
    label: 'Find in Document',
    description: 'Search inside the active Markdown document.',
    shortcuts: ['Ctrl+F'],
    keywords: ['search'],
    context: 'markdown',
  },
  {
    id: 'insert.table',
    category: 'Insert',
    label: 'Insert Table',
    description: 'Choose dimensions and insert a Markdown table.',
    keywords: ['grid', 'rows', 'columns', 'markdown'],
    context: 'markdown',
  },
  {
    id: 'tabs.next',
    category: 'Tabs',
    label: 'Next Tab',
    description: 'Activate the next open tab.',
    shortcuts: ['Ctrl+Tab'],
    context: 'activeTab',
  },
  {
    id: 'tabs.previous',
    category: 'Tabs',
    label: 'Previous Tab',
    description: 'Activate the previous open tab.',
    shortcuts: ['Ctrl+Shift+Tab'],
    context: 'activeTab',
  },
  {
    id: 'view.toggleSidebar',
    category: 'View',
    label: 'Toggle Sidebar',
    description: 'Show or hide the current sidebar.',
    shortcuts: ['Ctrl+B'],
  },
  {
    id: 'view.explorer',
    category: 'View',
    label: 'Show Explorer',
    description: 'Open the Explorer sidebar.',
    keywords: ['files', 'workspace'],
  },
  {
    id: 'view.zoomIn',
    category: 'View',
    label: 'Zoom In',
    description: 'Increase the application zoom level.',
  },
  {
    id: 'view.zoomOut',
    category: 'View',
    label: 'Zoom Out',
    description: 'Decrease the application zoom level.',
  },
  {
    id: 'view.resetZoom',
    category: 'View',
    label: 'Reset Zoom',
    description: 'Restore the application zoom level to 100%.',
  },
  {
    id: 'preferences.settings',
    category: 'Preferences',
    label: 'Open Settings',
    description: 'Open application and editor settings.',
    keywords: ['configuration'],
  },
  {
    id: 'preferences.keyboardShortcuts',
    category: 'Preferences',
    label: 'Open Keyboard Shortcuts',
    description: 'Show all keyboard shortcuts and their contexts.',
    keywords: ['keys', 'hotkeys', 'bindings'],
  },
];

export const shortcutEntries: readonly ShortcutEntry[] = [
  {
    category: 'General',
    label: 'Show Command Palette',
    shortcut: 'Ctrl+Shift+P',
    description: 'Search and execute application commands.',
  },
  ...appCommands.flatMap((command) =>
    (command.shortcuts ?? []).map((shortcut) => ({
      category: command.category,
      label: command.label,
      shortcut,
      description: command.description,
      when: command.context === 'markdown' ? 'Markdown editor' : undefined,
    })),
  ),
  {
    category: 'Tabs',
    label: 'Activate Tab by Position',
    shortcut: 'Ctrl+1 … Ctrl+9',
    description: 'Activate an open tab by its position.',
  },
  {
    category: 'Code Block',
    label: 'Move Line Up',
    shortcut: 'Alt+Arrow Up',
    description: 'Move the current line or selected lines upward.',
    when: 'Code block',
  },
  {
    category: 'Code Block',
    label: 'Move Line Down',
    shortcut: 'Alt+Arrow Down',
    description: 'Move the current line or selected lines downward.',
    when: 'Code block',
  },
  {
    category: 'Markdown Editor',
    label: 'Move Block Up',
    shortcut: 'Alt+Arrow Up',
    description: 'Move the selected block or list item upward.',
    when: 'Markdown editor',
  },
  {
    category: 'Markdown Editor',
    label: 'Move Block Down',
    shortcut: 'Alt+Arrow Down',
    description: 'Move the selected block or list item downward.',
    when: 'Markdown editor',
  },
  {
    category: 'Code Block',
    label: 'Indent',
    shortcut: 'Tab',
    description: 'Indent the current line or selection by two spaces.',
    when: 'Code block',
  },
  {
    category: 'Code Block',
    label: 'Outdent',
    shortcut: 'Shift+Tab',
    description: 'Remove one indentation level.',
    when: 'Code block',
  },
  {
    category: 'Code Block',
    label: 'Exit Code Block',
    shortcut: 'Shift+Enter',
    description: 'Move the cursor to a paragraph below the code block.',
    when: 'Code block',
  },
  {
    category: 'Code Block',
    label: 'Exit Code Block',
    shortcut: 'Ctrl+Enter',
    description: 'Move the cursor to a paragraph below the code block.',
    when: 'Code block',
  },
  {
    category: 'Image Viewer',
    label: 'Zoom In',
    shortcut: 'Ctrl++',
    description: 'Increase image zoom.',
    when: 'Image tab',
  },
  {
    category: 'Image Viewer',
    label: 'Zoom Out',
    shortcut: 'Ctrl+-',
    description: 'Decrease image zoom.',
    when: 'Image tab',
  },
  {
    category: 'Image Viewer',
    label: 'Fit to Window',
    shortcut: 'Ctrl+0',
    description: 'Fit the image inside the available viewport.',
    when: 'Image tab',
  },
];

export function filterCommands(query: string): readonly AppCommand[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return appCommands;
  return appCommands.filter((command) => {
    const searchable = [
      command.category,
      command.label,
      command.description,
      ...(command.keywords ?? []),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
