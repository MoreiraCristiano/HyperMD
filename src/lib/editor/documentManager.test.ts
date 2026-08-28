import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '../../test/tauriMocks';
import { dialogService, resolveDialog } from '../dialogs/dialogStore';
import { sidebarState } from '../sidebar/sidebarStore';
import { settingsActions } from '../settings/settingsStore';
import { tabsState, type EditorTab } from '../tabs/tabStore';
import type { EditorApi } from './editorTypes';
import { DocumentManager } from './documentManager';
import { MarkdownImage } from './extensions/image';
import { MarkdownSupport } from './markdown';

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
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/work/note.md', 'changed');
    expect(get(tabsState).tabs[0]).toMatchObject({ dirty: false, name: 'note.md' });
    tauriMocks.dialogSave.mockResolvedValue(null);
    await expect(manager.save(id, true)).resolves.toBe(false);

    manager.newDocument();
    tauriMocks.dialogSave.mockResolvedValue('/work/note.md');
    await expect(manager.save()).rejects.toThrow('already open');
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
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith(
      '/work/open.md',
      expect.stringContaining('./archive/moved.png'),
    );
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith(
      '/work/closed.md',
      expect.stringContaining('./archive/moved.png'),
    );
    expect(tauriMocks.writeTextFile).not.toHaveBeenCalledWith(
      '/work/untouched.md',
      expect.any(String),
    );
    instance.destroy();
    manager.dispose();
  });

  it('persists and restores session state', () => {
    const editor = fakeEditor();
    const manager = new DocumentManager();
    manager.attachEditor(editor);
    manager.persistSession();
    const saved = localStorage.getItem('hypermd.editor.session.v1');
    expect(saved).toContain('Untitled.md');
    manager.dispose();

    tabsState.set({ tabs: [], activeId: null, ready: false });
    const restored = new DocumentManager();
    restored.attachEditor(fakeEditor());
    expect(get(tabsState)).toMatchObject({ ready: true, tabs: [{ name: 'Untitled.md' }] });
    restored.dispose();
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
    tab.path = '/work/original.md';
    editor.setState(fakeState('changed'));
    manager.handleTransaction(editor.getState(), true);
    tauriMocks.writeTextFile
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    tauriMocks.dialogSave.mockResolvedValue('/work/recovered.md');
    await expect(manager.save(tab.id)).resolves.toBe(true);
    expect(tauriMocks.writeTextFile).toHaveBeenLastCalledWith('/work/recovered.md', 'changed');
    expect(tab.path).toBe('/work/recovered.md');
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
    expect(localStorage.getItem('hypermd.editor.session.v1')).not.toBeNull();
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
    expect(save).toHaveBeenCalledWith(tab.id);
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
