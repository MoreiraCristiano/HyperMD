import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '../../test/tauriMocks';
import { dialogService } from '../dialogs/dialogStore';
import Explorer from './Explorer.svelte';
import { WORKSPACE_ENTRY_DRAG_TYPE, WORKSPACE_IMAGE_DRAG_TYPE } from './dragTypes';
import { sidebarActions, sidebarState } from './sidebarStore';

const file = (name: string) => ({
  name,
  isFile: true,
  isDirectory: false,
  isSymlink: false,
});
const directory = (name: string) => ({
  name,
  isFile: false,
  isDirectory: true,
  isSymlink: false,
});

describe('Explorer', () => {
  const props = () => ({
    activePath: null,
    onOpenFile: vi.fn().mockResolvedValue(true),
    onChangeWorkspace: vi.fn().mockResolvedValue(true),
    onBeforeDelete: vi.fn().mockResolvedValue(true),
    onDeleted: vi.fn(),
    onRenamed: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
  });

  beforeEach(() => {
    sidebarState.set({
      visible: true,
      width: 240,
      activeView: 'explorer',
      workspacePath: '/work',
      workspaceName: 'Work',
    });
    tauriMocks.exists.mockResolvedValue(false);
    tauriMocks.stat.mockResolvedValue({ isDirectory: true });
    tauriMocks.readDir.mockImplementation(async (path: string) =>
      path === '/work/docs'
        ? [file('child.md')]
        : [directory('docs'), file('note.md'), file('a.png')],
    );
  });

  it('selects workspace from empty state and handles cancellation', async () => {
    sidebarState.update((state) => ({ ...state, workspacePath: null, workspaceName: null }));
    const handlers = props();
    tauriMocks.dialogOpen.mockResolvedValueOnce(null).mockResolvedValueOnce('/chosen');
    render(Explorer, handlers);
    const open = screen.getByRole('button', { name: 'Open Folder' });
    expect(open).toHaveClass('change-workspace');
    expect(open.parentElement).toHaveClass('explorer-content');
    await fireEvent.click(open);
    expect(handlers.onChangeWorkspace).not.toHaveBeenCalled();
    await fireEvent.click(open);
    expect(handlers.onChangeWorkspace).toHaveBeenCalledWith('/chosen');
  });

  it('loads tree, expands folders, opens files, and supports selection', async () => {
    const handlers = props();
    render(Explorer, handlers);
    const folder = await screen.findByRole('treeitem', { name: /docs/ });
    const note = screen.getByRole('treeitem', { name: /note.md/ });
    await fireEvent.click(folder);
    expect(await screen.findByRole('treeitem', { name: /child.md/ })).toBeInTheDocument();
    await fireEvent.click(note);
    expect(handlers.onOpenFile).toHaveBeenCalledWith('/work/note.md');
    await fireEvent.click(folder, { ctrlKey: true });
    await fireEvent.click(note, { shiftKey: true, ctrlKey: true });
    const tree = screen.getByRole('tree', { name: 'Workspace files' });
    await fireEvent.keyDown(tree, { key: 'a', ctrlKey: true });
    expect(note).toHaveAttribute('aria-selected', 'true');
    await fireEvent.click(folder);
    expect(screen.queryByRole('treeitem', { name: /child.md/ })).not.toBeInTheDocument();
  });

  it('creates files and folders then refreshes', async () => {
    const handlers = props();
    const prompt = vi
      .spyOn(dialogService, 'prompt')
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('folder');
    render(Explorer, handlers);
    await screen.findByRole('tree');
    await fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    await waitFor(() =>
      expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/work/created.md', ''),
    );
    await waitFor(() => expect(handlers.onOpenFile).toHaveBeenCalledWith('/work/created.md'));
    await fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await waitFor(() => expect(tauriMocks.mkdir).toHaveBeenCalledWith('/work/folder'));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(tauriMocks.readDir.mock.calls.length).toBeGreaterThan(2));
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('preserves expanded folders when creating at the root and in a folder', async () => {
    let rootFolderCreated = false;
    let nestedFolderCreated = false;
    tauriMocks.mkdir.mockImplementation(async (path: string) => {
      if (path === '/work/root-new') rootFolderCreated = true;
      if (path === '/work/docs/inside-new') nestedFolderCreated = true;
    });
    tauriMocks.readDir.mockImplementation(async (path: string) => {
      if (path === '/work/docs/nested') return [file('child.md')];
      if (path === '/work/docs/other') return [file('other.md')];
      if (path === '/work/docs') {
        return [
          directory('nested'),
          directory('other'),
          ...(nestedFolderCreated ? [directory('inside-new')] : []),
        ];
      }
      if (path === '/work/sibling') return [file('stay.md')];
      return [
        directory('docs'),
        directory('sibling'),
        ...(rootFolderCreated ? [directory('root-new')] : []),
      ];
    });
    vi.spyOn(dialogService, 'prompt')
      .mockResolvedValueOnce('root-new')
      .mockResolvedValueOnce('inside-new');
    render(Explorer, props());

    const docs = await screen.findByRole('treeitem', { name: /docs/ });
    await fireEvent.click(docs);
    const nested = await screen.findByRole('treeitem', { name: /nested/ });
    await fireEvent.click(nested);
    const other = screen.getByRole('treeitem', { name: 'other' });
    await fireEvent.click(other);
    const sibling = screen.getByRole('treeitem', { name: /sibling/ });
    await fireEvent.click(sibling);
    await fireEvent.click(screen.getByRole('tree', { name: 'Workspace files' }));

    await fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(await screen.findByRole('treeitem', { name: /root-new/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /docs/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /nested/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: 'other' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: /sibling/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: /child.md/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /other.md/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /stay.md/ })).toBeInTheDocument();

    await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /docs/ }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'New Folder' }));
    expect(await screen.findByRole('treeitem', { name: /inside-new/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /nested/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: 'other' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: /child.md/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /other.md/ })).toBeInTheDocument();
  });

  it('renames, moves, opens, refreshes, and deletes from context menus', async () => {
    const handlers = props();
    const prompt = vi.spyOn(dialogService, 'prompt');
    const confirm = vi.spyOn(dialogService, 'confirm').mockResolvedValue(true);
    render(Explorer, handlers);
    const note = await screen.findByRole('treeitem', { name: /note.md/ });

    prompt.mockResolvedValueOnce('renamed');
    await fireEvent.contextMenu(note, { clientX: 10, clientY: 10 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await waitFor(() =>
      expect(handlers.onRenamed).toHaveBeenCalledWith('/work/note.md', '/work/renamed.md', false),
    );

    const refreshedNote = await screen.findByRole('treeitem', { name: /renamed.md/ });
    prompt.mockResolvedValueOnce('docs');
    await fireEvent.contextMenu(refreshedNote);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Move' }));
    await waitFor(() =>
      expect(tauriMocks.rename).toHaveBeenCalledWith('/work/renamed.md', '/work/docs/renamed.md'),
    );

    const image = screen.getByRole('treeitem', { name: /a.png/ });
    await fireEvent.contextMenu(image);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(handlers.onOpenFile).toHaveBeenCalledWith('/work/a.png');

    await fireEvent.contextMenu(image);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() =>
      expect(tauriMocks.remove).toHaveBeenCalledWith('/work/a.png', { recursive: false }),
    );
    expect(handlers.onDeleted).toHaveBeenCalledWith('/work/a.png', false);
    expect(confirm).toHaveBeenCalled();
  });

  it('preserves expanded folders when renaming nested entries', async () => {
    tauriMocks.readDir.mockImplementation(async (path: string) => {
      if (path === '/work/docs') return [directory('nested')];
      if (path === '/work/docs/nested') return [file('child.md')];
      if (path === '/work/sibling') return [file('stay.md')];
      return [directory('docs'), directory('sibling')];
    });
    const handlers = props();
    vi.spyOn(dialogService, 'prompt')
      .mockResolvedValueOnce('renamed')
      .mockResolvedValueOnce('renamed-nested');
    render(Explorer, handlers);

    const docs = await screen.findByRole('treeitem', { name: /docs/ });
    await fireEvent.click(docs);
    const nested = await screen.findByRole('treeitem', { name: /nested/ });
    await fireEvent.click(nested);
    const sibling = screen.getByRole('treeitem', { name: /sibling/ });
    await fireEvent.click(sibling);
    const child = await screen.findByRole('treeitem', { name: /child.md/ });
    expect(screen.getByRole('treeitem', { name: /stay.md/ })).toBeInTheDocument();
    const readsBeforeRename = tauriMocks.readDir.mock.calls.length;

    await fireEvent.contextMenu(child);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await waitFor(() =>
      expect(handlers.onRenamed).toHaveBeenCalledWith(
        '/work/docs/nested/child.md',
        '/work/docs/nested/renamed.md',
        false,
      ),
    );

    expect(screen.getByRole('treeitem', { name: /docs/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /nested/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: /sibling/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: /renamed.md/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /stay.md/ })).toBeInTheDocument();
    expect(tauriMocks.readDir).toHaveBeenCalledTimes(readsBeforeRename);

    await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /nested/ }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await waitFor(() =>
      expect(handlers.onRenamed).toHaveBeenCalledWith(
        '/work/docs/nested',
        '/work/docs/renamed-nested',
        true,
      ),
    );
    const renamedFolder = screen.getByRole('treeitem', { name: /renamed-nested/ });
    expect(renamedFolder).toHaveAttribute('aria-expanded', 'true');
    const renamedChild = screen.getByRole('treeitem', { name: /renamed.md/ });
    await fireEvent.click(renamedChild);
    expect(handlers.onOpenFile).toHaveBeenCalledWith('/work/docs/renamed-nested/renamed.md');
    expect(tauriMocks.readDir).toHaveBeenCalledTimes(readsBeforeRename);
  });

  it('moves selected nodes with drag and reports operation errors', async () => {
    const handlers = props();
    render(Explorer, handlers);
    const folder = await screen.findByRole('treeitem', { name: /docs/ });
    const note = screen.getByRole('treeitem', { name: /note.md/ });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(note, { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.setData).toHaveBeenCalledWith(WORKSPACE_ENTRY_DRAG_TYPE, '/work/note.md');
    expect(transfer.setData).not.toHaveBeenCalledWith(
      WORKSPACE_IMAGE_DRAG_TYPE,
      expect.any(String),
    );
    await fireEvent.dragOver(folder, { dataTransfer: transfer });
    await fireEvent.drop(folder, { dataTransfer: transfer });
    await waitFor(() =>
      expect(tauriMocks.rename).toHaveBeenCalledWith('/work/note.md', '/work/docs/note.md'),
    );

    tauriMocks.readDir.mockRejectedValueOnce(new Error('read failed'));
    sidebarActions.refreshWorkspace('/work');
    await waitFor(() => expect(handlers.onError).toHaveBeenCalledWith('read failed'));
  });

  it('exposes dragged images as copyable editor payloads', async () => {
    render(Explorer, props());
    const image = await screen.findByRole('treeitem', { name: /a.png/ });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

    await fireEvent.dragStart(image, { dataTransfer: transfer });

    expect(transfer.effectAllowed).toBe('copyMove');
    expect(transfer.setData).toHaveBeenCalledWith(WORKSPACE_ENTRY_DRAG_TYPE, '/work/a.png');
    expect(transfer.setData).toHaveBeenCalledWith(WORKSPACE_IMAGE_DRAG_TYPE, '/work/a.png');
  });

  it('awaits reference updates sequentially for multi-file moves', async () => {
    const handlers = props();
    let finishFirst!: () => void;
    handlers.onRenamed
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    render(Explorer, handlers);
    const folder = await screen.findByRole('treeitem', { name: /docs/ });
    const note = screen.getByRole('treeitem', { name: /note.md/ });
    const image = screen.getByRole('treeitem', { name: /a.png/ });
    await fireEvent.click(note, { ctrlKey: true });
    await fireEvent.click(image, { ctrlKey: true });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

    await fireEvent.dragStart(note, { dataTransfer: transfer });
    await fireEvent.dragOver(folder, { dataTransfer: transfer });
    await fireEvent.drop(folder, { dataTransfer: transfer });
    await waitFor(() => expect(handlers.onRenamed).toHaveBeenCalledTimes(1));
    finishFirst();
    await waitFor(() => expect(handlers.onRenamed).toHaveBeenCalledTimes(2));
  });

  it('reports reference update failures after moving an image', async () => {
    const handlers = props();
    handlers.onRenamed.mockRejectedValueOnce(new Error('reference update failed'));
    render(Explorer, handlers);
    const folder = await screen.findByRole('treeitem', { name: /docs/ });
    const image = screen.getByRole('treeitem', { name: /a.png/ });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

    await fireEvent.dragStart(image, { dataTransfer: transfer });
    await fireEvent.dragOver(folder, { dataTransfer: transfer });
    await fireEvent.drop(folder, { dataTransfer: transfer });
    await waitFor(() => expect(handlers.onError).toHaveBeenCalledWith('reference update failed'));
  });

  it('handles multi-delete cancellation, denial, and completion from keyboard', async () => {
    const handlers = props();
    const confirm = vi
      .spyOn(dialogService, 'confirm')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    handlers.onBeforeDelete.mockResolvedValueOnce(false).mockResolvedValue(true);
    render(Explorer, handlers);
    const note = await screen.findByRole('treeitem', { name: /note.md/ });
    const image = screen.getByRole('treeitem', { name: /a.png/ });
    await fireEvent.click(note, { ctrlKey: true });
    await fireEvent.click(image, { ctrlKey: true });
    const tree = screen.getByRole('tree');
    await fireEvent.keyDown(tree, { key: 'Delete' });
    expect(tauriMocks.remove).not.toHaveBeenCalled();
    await fireEvent.keyDown(tree, { key: 'Delete' });
    await waitFor(() => expect(handlers.onBeforeDelete).toHaveBeenCalled());
    expect(tauriMocks.remove).not.toHaveBeenCalled();
    await fireEvent.keyDown(tree, { key: 'Delete' });
    await waitFor(() => expect(tauriMocks.remove).toHaveBeenCalledTimes(2));
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it('uses root and folder context actions and external refresh requests', async () => {
    const handlers = props();
    vi.spyOn(dialogService, 'prompt').mockResolvedValue('nested');
    render(Explorer, handlers);
    const region = screen.getByRole('region', { name: 'Explorer' });
    await screen.findByRole('tree');
    await fireEvent.contextMenu(region, { clientX: 5, clientY: 5 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'New Folder' }));
    await waitFor(() => expect(tauriMocks.mkdir).toHaveBeenCalledWith('/work/nested'));

    const folder = screen.getByRole('treeitem', { name: /docs/ });
    await fireEvent.contextMenu(folder);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Refresh' }));
    await waitFor(() => expect(tauriMocks.readDir).toHaveBeenCalledWith('/work/docs'));
    sidebarActions.refreshWorkspace('/unknown');
    await waitFor(() => expect(tauriMocks.readDir).toHaveBeenCalledWith('/work'));
  });

  it('leaves state unchanged when prompts and destructive actions are cancelled', async () => {
    const handlers = props();
    const prompt = vi.spyOn(dialogService, 'prompt').mockResolvedValue(null);
    vi.spyOn(dialogService, 'confirm').mockResolvedValue(false);
    render(Explorer, handlers);
    await screen.findByRole('tree');
    await fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    await fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(tauriMocks.writeTextFile).not.toHaveBeenCalled();
    expect(tauriMocks.mkdir).not.toHaveBeenCalled();

    const note = screen.getByRole('treeitem', { name: /note.md/ });
    await fireEvent.contextMenu(note);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await fireEvent.contextMenu(note);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Move' }));
    await fireEvent.contextMenu(note);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(tauriMocks.rename).not.toHaveBeenCalled();
    expect(tauriMocks.remove).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledTimes(4);
  });

  it('rejects invalid folder drag targets and clears blank-area selection', async () => {
    const handlers = props();
    render(Explorer, handlers);
    const folder = await screen.findByRole('treeitem', { name: /docs/ });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(folder, { dataTransfer: transfer });
    await fireEvent.dragOver(folder, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('none');
    await fireEvent.dragLeave(folder, { relatedTarget: document.body });
    await fireEvent.dragEnd(folder);
    const tree = screen.getByRole('tree');
    await fireEvent.click(tree);
    expect(folder).toHaveAttribute('aria-selected', 'false');
  });
});
