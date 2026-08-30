import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import { dialogService, resolveDialog } from '@/shared/ui/dialogs';
import { sidebarState } from '@/features/workspace/workspaceStore';
import { settingsActions } from '@/features/settings/settingsStore';
import { tabsState, type EditorTab } from './tabs/tabStore';
import type { EditorApi } from './editor/editorTypes';
import { DocumentManager } from './documentManager';
import { documentNotice, documentNoticeActions } from './documentNotice';
import { MarkdownImage } from './editor/extensions/image';
import { MarkdownSupport } from './editor/markdown';

function fakeState(content: string): EditorState {
  const doc = {
    content,
    eq(other: { content?: string }) {
      return other?.content === content;
    },
  } as unknown as ProseMirrorNode;
  return {
    doc,
    selection: { anchor: 1, head: 1 },
    schema: {},
    plugins: [],
  } as unknown as EditorState;
}

function fakeEditor() {
  let current = fakeState('');
  const api: EditorApi = {
    createState: vi.fn((markdown: string) => fakeState(markdown)),
    getState: vi.fn(() => current),
    setState: vi.fn((state) => {
      current = state;
    }),
    serializeState: vi.fn((state) => String((state.doc as unknown as { content: string }).content)),
    serializeNode: vi.fn((doc) => String((doc as unknown as { content: string }).content)),
    execute: vi.fn().mockResolvedValue(true),
    canInsertTable: vi.fn().mockReturnValue(true),
    insertTable: vi.fn().mockReturnValue(true),
    insertImage: vi.fn().mockReturnValue(true),
    insertImageIntoState: vi.fn((state) => state),
    focus: vi.fn(),
    openFind: vi.fn(),
  };
  return api;
}

function markdownEditor() {
  const instance = new TiptapEditor({
    element: document.createElement('div'),
    extensions: [StarterKit, MarkdownImage, MarkdownSupport],
    content: '',
    contentType: 'markdown',
  });
  const editor = fakeEditor();
  vi.mocked(editor.createState).mockImplementation((markdown: string) => {
    const doc = instance.schema.nodeFromJSON(instance.markdown!.parse(markdown));
    return EditorState.create({ schema: instance.schema, doc, plugins: instance.state.plugins });
  });
  vi.mocked(editor.serializeState).mockImplementation((state: EditorState) =>
    instance.markdown!.serialize(state.doc.toJSON()),
  );
  vi.mocked(editor.serializeNode).mockImplementation((doc: ProseMirrorNode) =>
    instance.markdown!.serialize(doc.toJSON()),
  );
  return { editor, instance };
}

describe('DocumentManager', () => {
  beforeEach(() => {
    documentNoticeActions.clear();
    tabsState.set({ tabs: [], activeId: null, ready: false });
    sidebarState.set({
      visible: true,
      width: 240,
      activeView: 'explorer',
      workspacePath: '/work',
      workspaceName: 'Work',
    });
    settingsActions.updateFiles({ autoSave: false });
    tauriMocks.exists.mockResolvedValue(false);
    tauriMocks.stat.mockResolvedValue({ isFile: true });
  });

  it('attaches editor, creates documents, and opens singleton utility tabs', () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    expect(get(tabsState)).toMatchObject({ ready: true, tabs: [{ name: 'Untitled.md' }] });
    manager.newDocument();
    expect(get(tabsState).tabs[1].name).toBe('Untitled 2.md');
    const settings = manager.openSettings();
    expect(manager.openSettings()).toBe(settings);
    const shortcuts = manager.openShortcuts();
    expect(manager.openShortcuts()).toBe(shortcuts);
    expect(get(tabsState).tabs.map(({ type }) => type)).toEqual([
      'markdown',
      'markdown',
      'settings',
      'shortcuts',
    ]);
    manager.dispose();
  });

  it('opens Markdown and image files, reuses duplicates, and rejects unsupported files', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    tauriMocks.readTextFile.mockResolvedValue('# Hello\r\nWorld');
    await expect(manager.open('C:/work/note.md')).resolves.toBe(true);
    expect(editor.createState).toHaveBeenCalledWith('# Hello\nWorld');
    const count = get(tabsState).tabs.length;
    await manager.open('c:/WORK/NOTE.md');
    expect(get(tabsState).tabs).toHaveLength(count);
    await expect(manager.open('/work/photo.png')).resolves.toBe(true);
    expect(get(tabsState).tabs.at(-1)).toMatchObject({ type: 'image', name: 'photo.png' });
    await expect(manager.open('/work/file.txt')).rejects.toThrow('Unsupported file type');
    manager.dispose();
  });

  it('does not rewrite an unchanged Markdown source', async () => {
    const source = '<!-- private -->\r\n\r\n<details>kept</details>\r\n';
    tauriMocks.readTextFile.mockResolvedValue(source);
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    await manager.open('/work/lossless.md');
    const tab = get(tabsState).tabs.at(-1)!;

    await expect(manager.save(tab.id)).resolves.toBe(true);

    expect(tauriMocks.conditionalAtomicWriteTextFile).not.toHaveBeenCalled();
    instance.destroy();
    manager.dispose();
  });

  it('copies unchanged Markdown source exactly with Save As', async () => {
    const source = '<!-- private -->\r\n\r\n<details>kept</details>\r\n';
    tauriMocks.readTextFile.mockResolvedValue(source);
    tauriMocks.dialogSave.mockResolvedValue('/work/copy.md');
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    await manager.open('/work/original.md');
    const tab = get(tabsState).tabs.at(-1)!;

    await expect(manager.save(tab.id, true)).resolves.toBe(true);

    expect(tauriMocks.conditionalAtomicWriteTextFile).toHaveBeenCalledWith(
      '/work/copy.md',
      source,
      { state: 'any' },
    );
    instance.destroy();
    manager.dispose();
  });

  it('preserves unsupported Markdown and original line endings around an edit', async () => {
    const source = [
      '---',
      'title: Secret',
      '---',
      '<!-- private -->',
      '<details>kept</details>',
      '',
      'Body text.',
      '',
      '[note]: ./target.md',
      '',
    ].join('\r\n');
    tauriMocks.readTextFile.mockResolvedValue(source);
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    await manager.open('/work/lossless.md');
    const tab = get(tabsState).tabs.at(-1)!;
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    manager.activate(tab.id);
    const edited = editor.createState(source.replace('Body text.', 'Changed body.'));
    editor.setState(edited);
    manager.handleTransaction(edited, true);

    await expect(manager.save(tab.id)).resolves.toBe(true);

    expect(tauriMocks.conditionalAtomicWriteTextFile).toHaveBeenCalledWith(
      '/work/lossless.md',
      source.replace('Body text.', 'Changed body.'),
      { state: 'revision', revision: `revision:${source}` },
    );
    instance.destroy();
    manager.dispose();
  });

  it('blocks overwrite when a lossless merge cannot be proven', async () => {
    const source = '<!-- private -->\n\nRead [original][note].\n\n[note]: ./target.md\n';
    tauriMocks.readTextFile.mockResolvedValue(source);
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    await manager.open('/work/lossless.md');
    const tab = get(tabsState).tabs.at(-1)!;
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    manager.activate(tab.id);
    const edited = editor.createState('Completely replaced.');
    editor.setState(edited);
    manager.handleTransaction(edited, true);
    const choose = vi.spyOn(dialogService, 'choose').mockResolvedValueOnce(null);

    await expect(manager.save(tab.id)).resolves.toBe(false);

    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Markdown cannot be saved losslessly' }),
    );
    expect(tauriMocks.conditionalAtomicWriteTextFile).not.toHaveBeenCalled();
    instance.destroy();
    manager.dispose();
  });

  it('activates, reorders, groups, and pins tabs safely', () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const one = get(tabsState).tabs[0];
    const twoId = manager.newDocument()!;
    const two = get(tabsState).tabs.find(({ id }) => id === twoId)!;
    manager.activate(one.id);
    expect(get(tabsState).activeId).toBe(one.id);
    expect(manager.reorderTab(one.id, two.id, 'after')).toBe(true);
    expect(get(tabsState).tabs.at(-1)?.id).toBe(one.id);
    expect(manager.setTabPinned(one.id, true)).toBe(true);
    expect(get(tabsState).tabs[0].id).toBe(one.id);
    expect(manager.reorderTab(one.id, two.id, 'before')).toBe(false);
    expect(manager.moveTabToGroupEnd(one.id)).toBe(true);
    expect(manager.setTabPinned(one.id, true)).toBe(false);
    expect(manager.reorderTab(one.id, one.id, 'before')).toBe(false);
    manager.activateRelative(1);
    manager.activatePosition(0);
    manager.dispose();
  });

  it('tracks transactions, saves, save-as, cancellation, and duplicate paths', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const id = get(tabsState).activeId!;
    const changed = fakeState('changed');
    editor.setState(changed);
    manager.handleTransaction(changed, true);
    expect(get(tabsState).tabs[0]).toMatchObject({ dirty: true });
    tauriMocks.dialogSave.mockResolvedValue('/work/note.md');
    await expect(manager.save()).resolves.toBe(true);
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith('/work/note.md', 'changed');
    expect(get(tabsState).tabs[0]).toMatchObject({ dirty: false, name: 'note.md' });
    tauriMocks.dialogSave.mockResolvedValue(null);
    await expect(manager.save(id, true)).resolves.toBe(false);

    manager.newDocument();
    tauriMocks.dialogSave.mockResolvedValue('/work/note.md');
    await expect(manager.save()).rejects.toThrow('already open');
    manager.dispose();
  });

  it('preserves an external edit and keeps the tab dirty on save conflict', async () => {
    tauriMocks.readTextFile.mockResolvedValue('disk original');
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await manager.open('/work/conflict.md');
    const tab = get(tabsState).tabs.at(-1)!;
    manager.activate(tab.id);
    editor.setState(fakeState('editor edit'));
    manager.handleTransaction(editor.getState(), true);
    tauriMocks.conditionalAtomicWriteTextFile.mockResolvedValue({
      status: 'conflict',
      kind: 'changed',
      actualRevision: 'revision:external edit',
    });
    vi.spyOn(dialogService, 'choose').mockResolvedValue(null);

    await expect(manager.save(tab.id)).resolves.toBe(false);

    expect(tab).toMatchObject({ dirty: true, diskRevision: 'revision:disk original' });
    expect(tauriMocks.conditionalAtomicWriteTextFile).toHaveBeenCalledWith(
      '/work/conflict.md',
      'editor edit',
      { state: 'revision', revision: 'revision:disk original' },
    );
    expect(tauriMocks.atomicWriteTextFile).not.toHaveBeenCalledWith(
      '/work/conflict.md',
      expect.anything(),
    );
    manager.dispose();
  });

  it('does not recreate a removed file and keeps Save As available', async () => {
    tauriMocks.readTextFile.mockResolvedValue('original');
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await manager.open('/work/removed.md');
    const tab = get(tabsState).tabs.at(-1)!;
    manager.activate(tab.id);
    editor.setState(fakeState('editor edit'));
    manager.handleTransaction(editor.getState(), true);
    tauriMocks.conditionalAtomicWriteTextFile
      .mockResolvedValueOnce({ status: 'conflict', kind: 'missing', actualRevision: null })
      .mockResolvedValueOnce({ status: 'success', revision: 'revision:editor edit' });
    vi.spyOn(dialogService, 'choose').mockResolvedValue('save-as');
    tauriMocks.dialogSave.mockResolvedValue('/work/recovered.md');

    await expect(manager.save(tab.id)).resolves.toBe(true);

    expect(tauriMocks.conditionalAtomicWriteTextFile.mock.calls).toEqual([
      ['/work/removed.md', 'editor edit', { state: 'revision', revision: 'revision:original' }],
      ['/work/recovered.md', 'editor edit', { state: 'any' }],
    ]);
    expect(tab).toMatchObject({
      path: '/work/recovered.md',
      dirty: false,
      diskRevision: 'revision:editor edit',
    });
    manager.dispose();
  });

  it('overwrites a conflicting file only after explicit confirmation', async () => {
    tauriMocks.readTextFile.mockResolvedValue('original');
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await manager.open('/work/overwrite.md');
    const tab = get(tabsState).tabs.at(-1)!;
    manager.activate(tab.id);
    editor.setState(fakeState('intentional'));
    manager.handleTransaction(editor.getState(), true);
    tauriMocks.conditionalAtomicWriteTextFile
      .mockResolvedValueOnce({
        status: 'conflict',
        kind: 'changed',
        actualRevision: 'revision:external',
      })
      .mockResolvedValueOnce({ status: 'success', revision: 'revision:intentional' });
    vi.spyOn(dialogService, 'choose').mockResolvedValue('overwrite');

    await expect(manager.save(tab.id)).resolves.toBe(true);

    expect(tauriMocks.conditionalAtomicWriteTextFile.mock.calls[1]).toEqual([
      '/work/overwrite.md',
      'intentional',
      { state: 'any' },
    ]);
    expect(tab).toMatchObject({ dirty: false, diskRevision: 'revision:intentional' });
    manager.dispose();
  });

  it('uses the revision returned by a successful save for the next save', async () => {
    tauriMocks.readTextFile.mockResolvedValue('initial');
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await manager.open('/work/consecutive.md');
    const tab = get(tabsState).tabs.at(-1)!;
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    manager.activate(tab.id);
    tauriMocks.conditionalAtomicWriteTextFile
      .mockResolvedValueOnce({ status: 'success', revision: 'revision:first' })
      .mockResolvedValueOnce({ status: 'success', revision: 'revision:second' });

    editor.setState(fakeState('first'));
    manager.handleTransaction(editor.getState(), true);
    await manager.save(tab.id);
    editor.setState(fakeState('second'));
    manager.handleTransaction(editor.getState(), true);
    await manager.save(tab.id);

    expect(tauriMocks.conditionalAtomicWriteTextFile.mock.calls).toEqual([
      ['/work/consecutive.md', 'first', { state: 'revision', revision: 'revision:initial' }],
      ['/work/consecutive.md', 'second', { state: 'revision', revision: 'revision:first' }],
    ]);
    expect(tab.diskRevision).toBe('revision:second');
    manager.dispose();
  });

  it('stops autosave after a conflict and exposes a visible warning', async () => {
    vi.useFakeTimers();
    settingsActions.updateFiles({ autoSave: true });
    tauriMocks.readTextFile.mockResolvedValue('initial');
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await manager.open('/work/autosave.md');
    const tab = get(tabsState).tabs.at(-1)!;
    manager.activate(tab.id);
    tauriMocks.conditionalAtomicWriteTextFile.mockResolvedValue({
      status: 'conflict',
      kind: 'changed',
      actualRevision: 'revision:external',
    });
    editor.setState(fakeState('editor edit'));
    manager.handleTransaction(editor.getState(), true);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(tauriMocks.conditionalAtomicWriteTextFile).toHaveBeenCalledTimes(1);
    expect(tab.dirty).toBe(true);
    expect(get(documentNotice)).toMatch(/Auto Save stopped.*outside HyperMD/i);
    manager.dispose();
  });

  it('closes clean and dirty tabs according to dialog choice', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const cleanId = get(tabsState).activeId!;
    await expect(manager.close(cleanId)).resolves.toBe(true);
    expect(get(tabsState).tabs).toHaveLength(0);

    const dirtyId = manager.newDocument()!;
    manager.handleTransaction(fakeState('dirty'), true);
    const choose = vi.spyOn(dialogService, 'choose').mockResolvedValueOnce(null);
    await expect(manager.close(dirtyId)).resolves.toBe(false);
    choose.mockResolvedValueOnce('discard');
    await expect(manager.close(dirtyId)).resolves.toBe(true);
    expect(get(tabsState).tabs).toHaveLength(0);
    manager.dispose();
  });

  it('executes editor commands, opens find, and handles path changes', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    tab.path = '/work/docs/a.md';
    tabsState.update((state) => ({ ...state, tabs: [...state.tabs] }));
    await expect(manager.execute('undo')).resolves.toBe(true);
    expect(manager.canInsertTable()).toBe(true);
    expect(manager.insertTable(4, 3)).toBe(true);
    expect(editor.insertTable).toHaveBeenCalledWith(4, 3);
    expect(manager.openFind()).toBe(true);
    expect(editor.openFind).toHaveBeenCalled();
    manager.markMissing('/work/docs', true);
    expect(get(tabsState).tabs[0].missing).toBe(true);
    await manager.renamePath('/work/docs', '/work/new', true);
    expect(get(tabsState).tabs[0]).toMatchObject({ path: '/work/new/a.md', missing: false });
    manager.dispose();
  });

  it('updates moved image references on disk without saving unrelated dirty edits', async () => {
    tauriMocks.readDir.mockResolvedValue([
      { name: 'open.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'closed.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'untouched.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'moved.png', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    tauriMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === '/work/open.md') return 'Saved ![](./images/moved.png)';
      if (path === '/work/closed.md') return 'Closed ![](./images/moved.png)';
      if (path === '/work/untouched.md') return 'Keep ![](./other/moved.png)';
      throw new Error(`Unexpected read: ${path}`);
    });
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    tab.path = '/work/open.md';
    const saved = editor.createState('Saved ![](./images/moved.png)');
    const current = editor.createState('Saved ![](./images/moved.png)\n\nUnsaved edit');
    tab.savedDoc = saved.doc;
    tab.state = current;
    tab.dirty = true;
    editor.setState(current);

    await manager.renamePath('/work/images/moved.png', '/work/archive/moved.png', false);

    const updated = get(tabsState).tabs[0];
    if (updated.type !== 'markdown') throw new Error('Expected Markdown tab.');
    expect(editor.serializeState(updated.state)).toContain('./archive/moved.png');
    expect(editor.serializeState(updated.state)).toContain('Unsaved edit');
    expect(editor.serializeNode(updated.savedDoc)).toContain('./archive/moved.png');
    expect(editor.serializeNode(updated.savedDoc)).not.toContain('Unsaved edit');
    expect(updated.dirty).toBe(true);
    expect(editor.setState).toHaveBeenLastCalledWith(updated.state);
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith(
      '/work/open.md',
      expect.stringContaining('./archive/moved.png'),
    );
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith(
      '/work/closed.md',
      expect.stringContaining('./archive/moved.png'),
    );
    expect(tauriMocks.atomicWriteTextFile).not.toHaveBeenCalledWith(
      '/work/untouched.md',
      expect.any(String),
    );
    instance.destroy();
    manager.dispose();
  });

  it('plans an image rename with no references without writing Markdown', async () => {
    tauriMocks.readDir.mockResolvedValue([
      { name: 'plain.md', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    tauriMocks.readTextFile.mockResolvedValue('No images here.');
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);

    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/renamed.png',
    );
    const result = await manager.writeWorkspaceImageRename(plan);

    expect(plan.documents).toEqual([]);
    expect(result).toEqual({ status: 'committed', completed: [] });
    expect(tauriMocks.atomicWriteTextFile).not.toHaveBeenCalledWith(
      '/work/plain.md',
      expect.any(String),
    );
    instance.destroy();
    manager.dispose();
  });

  it('renames image references without normalizing surrounding Markdown', async () => {
    const source = [
      '---',
      'title: Secret',
      '---',
      '<!-- private -->',
      '![Image](./image.png "Title")',
      '',
    ].join('\r\n');
    tauriMocks.readDir.mockResolvedValue([
      { name: 'rich.md', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    tauriMocks.readTextFile.mockResolvedValue(source);
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);

    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/archive/image.png',
    );
    await manager.writeWorkspaceImageRename(plan);

    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith(
      '/work/rich.md',
      source.replace('./image.png', './archive/image.png'),
    );
    instance.destroy();
    manager.dispose();
  });

  it('does not write anything when image-reference preflight cannot read a document', async () => {
    tauriMocks.readDir.mockResolvedValue([
      { name: 'a.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'broken.md', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    tauriMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === '/work/a.md') return '![](./image.png)';
      throw new Error('read denied');
    });
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);

    await expect(
      manager.planWorkspaceImageRename('/work', '/work/image.png', '/work/renamed.png'),
    ).rejects.toThrow('read denied');
    expect(tauriMocks.atomicWriteTextFile).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.md$/),
      expect.any(String),
    );
    instance.destroy();
    manager.dispose();
  });

  it('reports a first Markdown write failure as fully rolled back', async () => {
    tauriMocks.readDir.mockResolvedValue([
      { name: 'a.md', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    tauriMocks.readTextFile.mockResolvedValue('A ![](./image.png)');
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/renamed.png',
    );
    tauriMocks.atomicWriteTextFile.mockRejectedValueOnce(new Error('disk full'));

    const result = await manager.writeWorkspaceImageRename(plan);

    expect(result).toMatchObject({ status: 'rolled-back', completed: [], recovered: [] });
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(1);
    instance.destroy();
    manager.dispose();
  });

  it('restores several committed Markdown writes in reverse order after a later failure', async () => {
    tauriMocks.readDir.mockResolvedValue(
      ['a.md', 'b.md', 'c.md'].map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      })),
    );
    tauriMocks.readTextFile.mockImplementation(
      async (path: string) => `${path}\r\n![](./image.png)`,
    );
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/renamed.png',
    );
    tauriMocks.atomicWriteTextFile.mockImplementation(async (path: string) => {
      if (path === '/work/c.md') throw new Error('third write failed');
    });

    const result = await manager.writeWorkspaceImageRename(plan);

    expect(result).toMatchObject({
      status: 'rolled-back',
      completed: ['/work/a.md', '/work/b.md'],
      recovered: ['/work/b.md', '/work/a.md'],
    });
    expect(tauriMocks.atomicWriteTextFile.mock.calls.map(([path]) => path)).toEqual([
      '/work/a.md',
      '/work/b.md',
      '/work/c.md',
      '/work/b.md',
      '/work/a.md',
    ]);
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenNthCalledWith(
      5,
      '/work/a.md',
      '/work/a.md\r\n![](./image.png)',
    );
    instance.destroy();
    manager.dispose();
  });

  it('reports exact Markdown paths when rollback itself fails', async () => {
    tauriMocks.readDir.mockResolvedValue(
      ['a.md', 'b.md'].map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      })),
    );
    tauriMocks.readTextFile.mockImplementation(async (path: string) => `${path} ![](./image.png)`);
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/renamed.png',
    );
    tauriMocks.atomicWriteTextFile.mockImplementation(async (path: string, contents: string) => {
      if (path === '/work/b.md') throw new Error('commit failed');
      if (path === '/work/a.md' && contents === '/work/a.md ![](./image.png)') {
        throw new Error('rollback failed');
      }
    });

    const result = await manager.writeWorkspaceImageRename(plan);

    expect(result).toMatchObject({
      status: 'partial',
      completed: ['/work/a.md'],
      recovered: [],
      unrecovered: ['/work/a.md'],
      rollbackFailures: [{ path: '/work/a.md', failure: { kind: 'io-error' } }],
    });
    instance.destroy();
    manager.dispose();
  });

  it('preserves a document changed after image-rename preflight', async () => {
    const manager = new DocumentManager();
    const plan = {
      workspaceRoot: '/work',
      oldImagePath: '/work/image.png',
      newImagePath: '/work/renamed.png',
      documents: [
        {
          path: '/work/a.md',
          original: 'old',
          originalRevision: 'revision:old',
          updated: 'new',
        },
      ],
    };
    tauriMocks.conditionalAtomicWriteTextFile.mockResolvedValue({
      status: 'conflict',
      kind: 'changed',
      actualRevision: 'revision:external',
    });

    await expect(manager.writeWorkspaceImageRename(plan)).resolves.toMatchObject({
      status: 'rolled-back',
      completed: [],
      recovered: [],
      failure: { kind: 'conflict', path: '/work/a.md' },
    });
    expect(tauriMocks.conditionalAtomicWriteTextFile).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('rolls earlier image-reference writes back after a later conflict', async () => {
    const manager = new DocumentManager();
    const plan = {
      workspaceRoot: '/work',
      oldImagePath: '/work/image.png',
      newImagePath: '/work/renamed.png',
      documents: [
        { path: '/work/a.md', original: 'old a', originalRevision: 'rev-a', updated: 'new a' },
        { path: '/work/b.md', original: 'old b', originalRevision: 'rev-b', updated: 'new b' },
      ],
    };
    tauriMocks.conditionalAtomicWriteTextFile
      .mockResolvedValueOnce({ status: 'success', revision: 'written-a' })
      .mockResolvedValueOnce({ status: 'conflict', kind: 'changed', actualRevision: 'external-b' })
      .mockResolvedValueOnce({ status: 'success', revision: 'rev-a' });

    await expect(manager.writeWorkspaceImageRename(plan)).resolves.toMatchObject({
      status: 'rolled-back',
      completed: ['/work/a.md'],
      recovered: ['/work/a.md'],
      failure: { kind: 'conflict', path: '/work/b.md' },
    });
    expect(tauriMocks.conditionalAtomicWriteTextFile.mock.calls[2]).toEqual([
      '/work/a.md',
      'old a',
      { state: 'revision', revision: 'written-a' },
    ]);
    manager.dispose();
  });

  it('never overwrites an external edit made before image-reference rollback', async () => {
    const manager = new DocumentManager();
    const plan = {
      workspaceRoot: '/work',
      oldImagePath: '/work/image.png',
      newImagePath: '/work/renamed.png',
      documents: [
        { path: '/work/a.md', original: 'old a', originalRevision: 'rev-a', updated: 'new a' },
        { path: '/work/b.md', original: 'old b', originalRevision: 'rev-b', updated: 'new b' },
      ],
    };
    tauriMocks.conditionalAtomicWriteTextFile
      .mockResolvedValueOnce({ status: 'success', revision: 'written-a' })
      .mockResolvedValueOnce({ status: 'conflict', kind: 'changed', actualRevision: 'external-b' })
      .mockResolvedValueOnce({
        status: 'conflict',
        kind: 'changed',
        actualRevision: 'external-after-commit-a',
      });

    await expect(manager.writeWorkspaceImageRename(plan)).resolves.toMatchObject({
      status: 'partial',
      completed: ['/work/a.md'],
      recovered: [],
      unrecovered: ['/work/a.md'],
      rollbackFailures: [{ path: '/work/a.md', failure: { kind: 'conflict', path: '/work/a.md' } }],
    });
    manager.dispose();
  });

  it('resolves a normal save racing an image rename without losing content', async () => {
    tauriMocks.readTextFile.mockResolvedValue('old');
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await manager.open('/work/a.md');
    const tab = get(tabsState).tabs.at(-1)!;
    manager.activate(tab.id);
    editor.setState(fakeState('normal save'));
    manager.handleTransaction(editor.getState(), true);
    let currentRevision = 'revision:old';
    let currentContents = 'old';
    let pathQueue = Promise.resolve();
    tauriMocks.conditionalAtomicWriteTextFile.mockImplementation(
      (_path: string, contents: string, expected: { state: string; revision?: string }) => {
        const operation = pathQueue.then(() => {
          if (expected.state === 'revision' && expected.revision !== currentRevision) {
            return {
              status: 'conflict' as const,
              kind: 'changed' as const,
              actualRevision: currentRevision,
            };
          }
          currentContents = contents;
          currentRevision = `revision:${contents}`;
          return { status: 'success' as const, revision: currentRevision };
        });
        pathQueue = operation.then(() => undefined);
        return operation;
      },
    );
    const plan = {
      workspaceRoot: '/work',
      oldImagePath: '/work/image.png',
      newImagePath: '/work/renamed.png',
      documents: [
        {
          path: '/work/a.md',
          original: 'old',
          originalRevision: 'revision:old',
          updated: 'image rename',
        },
      ],
    };

    const save = manager.save(tab.id);
    await Promise.resolve();
    const rename = manager.writeWorkspaceImageRename(plan);

    await expect(save).resolves.toBe(true);
    await expect(rename).resolves.toMatchObject({
      status: 'rolled-back',
      failure: { kind: 'conflict', path: '/work/a.md' },
    });
    expect(currentContents).toBe('normal save');
    manager.dispose();
  });

  it('preserves an edit made in an open tab after image-rename preflight', async () => {
    tauriMocks.readDir.mockResolvedValue([
      { name: 'open.md', isFile: true, isDirectory: false, isSymlink: false },
    ]);
    tauriMocks.readTextFile.mockResolvedValue('Saved ![](./image.png)');
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    tab.path = '/work/open.md';
    tab.state = editor.createState('Saved ![](./image.png)');
    tab.savedDoc = tab.state.doc;
    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/renamed.png',
    );
    tab.state = editor.createState('Saved ![](./image.png)\n\nConcurrent edit');
    tab.dirty = true;

    const result = await manager.writeWorkspaceImageRename(plan);
    if (result.status !== 'committed') throw new Error('Expected committed write.');
    await manager.reconcileWorkspaceImageRename(plan, result.completed);

    const updated = get(tabsState).tabs[0];
    if (updated.type !== 'markdown') throw new Error('Expected Markdown tab.');
    expect(editor.serializeState(updated.state)).toContain('./renamed.png');
    expect(editor.serializeState(updated.state)).toContain('Concurrent edit');
    expect(updated.dirty).toBe(true);
    instance.destroy();
    manager.dispose();
  });

  it('reports preflight progress across hundreds of Markdown files', async () => {
    const entries = Array.from({ length: 240 }, (_, index) => ({
      name: `note-${index}.md`,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    }));
    tauriMocks.readDir.mockResolvedValue(entries);
    tauriMocks.readTextFile.mockResolvedValue('Plain text.');
    const progress = vi.fn();
    const { editor, instance } = markdownEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);

    const plan = await manager.planWorkspaceImageRename(
      '/work',
      '/work/image.png',
      '/work/renamed.png',
      { onProgress: progress },
    );

    expect(plan.documents).toEqual([]);
    expect(tauriMocks.readTextFile).toHaveBeenCalledTimes(240);
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'preflight',
      completed: 240,
      total: 240,
      cancelable: true,
    });
    instance.destroy();
    manager.dispose();
  });

  it('flushes recoverable session state to AppConfig', async () => {
    const editor = fakeEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);

    await manager.flushSession();

    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith(
      'session-v2.json',
      expect.stringContaining('Untitled.md'),
      13,
    );
    manager.dispose();
  });

  it('returns false when no editor or active Markdown tab exists', async () => {
    const manager = new DocumentManager();
    await expect(manager.open('/work/a.md')).resolves.toBe(false);
    await expect(manager.save()).resolves.toBe(false);
    await expect(manager.execute('copy')).resolves.toBe(false);
    expect(manager.canInsertTable()).toBe(false);
    expect(manager.insertTable(2, 2)).toBe(false);
    expect(manager.openFind()).toBe(false);
    await expect(
      manager.pasteClipboardImage(new Blob(['x']), { anchor: 1, head: 1 }),
    ).resolves.toBe(false);
    manager.dispose();
    resolveDialog(null);
  });

  it('falls back to Save As after a denied direct write', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    tab.path = '/work/original.md';
    tab.diskRevision = 'revision:original';
    editor.setState(fakeState('changed'));
    manager.handleTransaction(editor.getState(), true);
    tauriMocks.atomicWriteTextFile
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    tauriMocks.dialogSave.mockResolvedValue('/work/recovered.md');
    await expect(manager.save(tab.id)).resolves.toBe(true);
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenLastCalledWith(
      '/work/recovered.md',
      'changed',
    );
    expect(tab.path).toBe('/work/recovered.md');
    manager.dispose();
  });

  it('serializes saves for the same tab and keeps the newest content', async () => {
    let finishFirstWrite!: () => void;
    tauriMocks.atomicWriteTextFile
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstWrite = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    tab.path = '/work/a.md';
    tab.diskRevision = 'revision:start';

    editor.setState(fakeState('first'));
    manager.handleTransaction(editor.getState(), true);
    const firstSave = manager.save(tab.id);
    await vi.waitFor(() => expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(1));

    editor.setState(fakeState('second'));
    manager.handleTransaction(editor.getState(), true);
    const secondSave = manager.save(tab.id);
    await Promise.resolve();
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(1);

    finishFirstWrite();
    await expect(firstSave).resolves.toBe(true);
    await expect(secondSave).resolves.toBe(true);
    expect(tauriMocks.atomicWriteTextFile.mock.calls).toEqual([
      ['/work/a.md', 'first'],
      ['/work/a.md', 'second'],
    ]);
    expect(tab.dirty).toBe(false);
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    expect(editor.serializeNode(tab.savedDoc)).toBe('second');
    manager.dispose();
  });

  it('continues a tab save queue after an earlier save fails', async () => {
    tauriMocks.dialogSave.mockResolvedValue('/work/a.md');
    tauriMocks.atomicWriteTextFile
      .mockRejectedValueOnce(new Error('disk failure'))
      .mockResolvedValueOnce(undefined);
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    editor.setState(fakeState('content'));
    manager.handleTransaction(editor.getState(), true);

    const failed = manager.save(tab.id, true);
    const recovered = manager.save(tab.id, true);

    await expect(failed).rejects.toThrow('disk failure');
    await expect(recovered).resolves.toBe(true);
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(2);
    expect(tab.path).toBe('/work/a.md');
    manager.dispose();
  });

  it('reserves a save path while another tab is writing it', async () => {
    let finishWrite!: () => void;
    tauriMocks.dialogSave.mockResolvedValue('/work/shared.md');
    tauriMocks.atomicWriteTextFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const first = get(tabsState).tabs[0];
    if (first.type !== 'markdown') throw new Error('Expected Markdown tab.');
    first.state = fakeState('first');
    first.dirty = true;
    const secondId = manager.newDocument()!;
    editor.setState(fakeState('second'));
    manager.handleTransaction(editor.getState(), true);

    const firstSave = manager.save(first.id, true);
    await vi.waitFor(() => expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(1));
    await expect(manager.save(secondId, true)).rejects.toThrow(
      'This file is already open in another tab.',
    );
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(1);

    finishWrite();
    await expect(firstSave).resolves.toBe(true);
    manager.dispose();
  });

  it('waits for an active save before closing its tab', async () => {
    let finishWrite!: () => void;
    tauriMocks.atomicWriteTextFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    if (tab.type !== 'markdown') throw new Error('Expected Markdown tab.');
    tab.path = '/work/a.md';
    tab.diskRevision = 'revision:start';
    editor.setState(fakeState('content'));
    manager.handleTransaction(editor.getState(), true);

    const save = manager.save(tab.id);
    await vi.waitFor(() => expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledTimes(1));
    const close = manager.close(tab.id);
    await Promise.resolve();
    expect(get(tabsState).tabs).toHaveLength(1);

    finishWrite();
    await expect(save).resolves.toBe(true);
    await expect(close).resolves.toBe(true);
    expect(get(tabsState).tabs).toHaveLength(0);
    manager.dispose();
  });

  it('closes all workspace tabs while keeping outside utility tabs', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const first = get(tabsState).tabs[0];
    first.path = '/work/a.md';
    const outsideId = manager.newDocument()!;
    const outside = get(tabsState).tabs.find(({ id }) => id === outsideId)!;
    outside.path = '/other/b.md';
    manager.openSettings();
    manager.activate(first.id);
    await expect(manager.closeWorkspaceTabs('/work')).resolves.toBe(true);
    expect(get(tabsState).tabs.map(({ path }) => path)).toEqual(['/other/b.md', null]);
    expect(get(tabsState).activeId).toBe(outsideId);
    await expect(manager.closeWorkspaceTabs('/missing')).resolves.toBe(true);
    manager.dispose();
  });

  it('honors dirty choices before window close', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    editor.setState(fakeState('dirty'));
    manager.handleTransaction(editor.getState(), true);
    const choose = vi.spyOn(dialogService, 'choose').mockResolvedValueOnce(null);
    await expect(manager.prepareWindowClose()).resolves.toBe(false);
    choose.mockResolvedValueOnce('save');
    vi.spyOn(manager, 'save').mockResolvedValue(true);
    await expect(manager.prepareWindowClose()).resolves.toBe(true);
    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith(
      'session-v2.json',
      expect.any(String),
      13,
    );
    manager.dispose();
  });

  it('imports clipboard images and requests a workspace when absent', async () => {
    sidebarState.update((state) => ({ ...state, workspacePath: null }));
    tauriMocks.dialogOpen.mockResolvedValue('/chosen');
    tauriMocks.openFile.mockResolvedValue({
      write: vi.fn().mockResolvedValue(1),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    await expect(
      manager.pasteClipboardImage(new Blob(['x'], { type: 'image/png' }), {
        anchor: 1,
        head: 1,
      }),
    ).resolves.toBe(true);
    expect(get(sidebarState)).toMatchObject({ workspacePath: '/chosen', workspaceName: 'chosen' });
    expect(editor.insertImage).toHaveBeenCalledWith(expect.stringContaining('.png'), 'image', {
      anchor: 1,
      head: 1,
    });
    manager.dispose();
  });

  it('inserts workspace images with a relative path and empty alt text', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    if (tab.type === 'markdown') tab.path = '/work/docs/note.md';
    const selection = { anchor: 4, head: 4 };

    await expect(manager.insertWorkspaceImage('/work/images/a.png', selection)).resolves.toBe(true);
    expect(editor.insertImage).toHaveBeenCalledWith('../images/a.png', '', selection);

    if (tab.type === 'markdown') tab.path = null;
    await manager.insertWorkspaceImage('/work/a.png', selection);
    expect(editor.insertImage).toHaveBeenLastCalledWith('./a.png', '', selection);
    manager.dispose();
  });

  it('finishes an image drop in its original tab after an asynchronous tab change', async () => {
    let resolveStat!: (value: { isFile: boolean }) => void;
    tauriMocks.stat.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStat = resolve;
      }),
    );
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const original = get(tabsState).tabs[0];
    if (original.type === 'markdown') original.path = '/work/docs/note.md';
    const selection = { anchor: 2, head: 2 };

    const insertion = manager.insertWorkspaceImage('/work/a.png', selection);
    manager.newDocument();
    resolveStat({ isFile: true });

    await expect(insertion).resolves.toBe(true);
    expect(editor.insertImage).not.toHaveBeenCalled();
    expect(editor.insertImageIntoState).toHaveBeenCalledWith(
      original.type === 'markdown' ? original.state : expect.anything(),
      '../a.png',
      '',
      selection,
    );
    manager.dispose();
  });

  it('autosaves dirty file tabs after configured delay and cancels when disabled', async () => {
    vi.useFakeTimers();
    settingsActions.updateFiles({ autoSave: true });
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    tab.path = '/work/a.md';
    const save = vi.spyOn(manager, 'save').mockResolvedValue(true);
    editor.setState(fakeState('dirty'));
    manager.handleTransaction(editor.getState(), true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledWith(tab.id, false, 'auto');
    manager.handleTransaction(fakeState('again'), true);
    settingsActions.updateFiles({ autoSave: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('handles missing, utility, same-tab, and no-op manager branches', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const markdown = get(tabsState).tabs[0];
    if (markdown.type !== 'markdown') throw new Error('Expected initial Markdown tab.');
    const settingsId = manager.openSettings()!;
    manager.activate(settingsId);
    manager.activate(settingsId);
    manager.activate('missing');
    expect(await manager.save(settingsId)).toBe(true);
    expect(await manager.save('missing')).toBe(false);
    expect(await manager.execute('copy')).toBe(false);
    expect(manager.openFind()).toBe(false);
    manager.handleTransaction(fakeState('ignored'), true);
    expect(manager.reorderTab('missing', settingsId, 'before')).toBe(false);
    expect(manager.moveTabToGroupEnd('missing')).toBe(false);
    expect(manager.setTabPinned('missing', true)).toBe(false);
    expect(await manager.close('missing')).toBe(true);
    manager.activate(markdown.id);
    manager.handleTransaction(markdown.state, false);
    manager.activateRelative(0);
    manager.activatePosition(99);
    manager.markMissing('/not-open', false);
    manager.renamePath('/not-open', '/new', true);
    manager.dispose();
  });

  it('cancels workspace closure and image import at user decision points', async () => {
    const manager = new DocumentManager();
    const editor = fakeEditor();
    manager.attachEditor(editor);
    const tab = get(tabsState).tabs[0];
    tab.path = '/work/a.md';
    editor.setState(fakeState('dirty'));
    manager.handleTransaction(editor.getState(), true);
    vi.spyOn(dialogService, 'choose').mockResolvedValue(null);
    await expect(manager.closeWorkspaceTabs('/work')).resolves.toBe(false);

    sidebarState.update((state) => ({ ...state, workspacePath: null }));
    tauriMocks.dialogOpen.mockResolvedValue(null);
    await expect(
      manager.pasteClipboardImage(new Blob(['x'], { type: 'image/png' }), { anchor: 1, head: 1 }),
    ).resolves.toBe(false);
    manager.dispose();
  });

  it('recovers from malformed and unusable persisted sessions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('hypermd.editor.session.v1', '{broken');
    const malformed = new DocumentManager();
    malformed.attachEditor(fakeEditor());
    expect(warn).toHaveBeenCalled();
    malformed.dispose();

    tabsState.set({ tabs: [], activeId: null, ready: false });
    localStorage.setItem(
      'hypermd.editor.session.v1',
      JSON.stringify({ activeId: 'missing', tabs: [{ id: '', type: 'unknown' }] }),
    );
    const unusable = new DocumentManager();
    unusable.attachEditor(fakeEditor());
    expect(get(tabsState).tabs).toHaveLength(1);
    unusable.dispose();
  });
});
