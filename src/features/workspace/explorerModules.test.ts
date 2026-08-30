import { describe, expect, it, vi } from 'vitest';
import { ExplorerCommands } from './explorerCommands';
import { ExplorerDragController } from './explorerDrag.svelte';
import { ExplorerMoveController } from './explorerMove.svelte';
import type { ExplorerOperations, FileNode } from './explorerOperations';
import { ExplorerSelection } from './explorerSelection.svelte';
import { ExplorerTree } from './explorerTree.svelte';
import { WORKSPACE_ENTRY_DRAG_TYPE, WORKSPACE_IMAGE_DRAG_TYPE } from './components/dragTypes';

function file(path: string, type: FileNode['type'] = 'markdown'): FileNode {
  return {
    name: path.split('/').at(-1)!,
    path,
    isDirectory: false,
    type,
    expanded: false,
    loading: false,
    loaded: false,
    children: [],
  };
}

function directory(path: string, children: FileNode[] = []): FileNode {
  return {
    ...file(path, null),
    isDirectory: true,
    expanded: true,
    loaded: true,
    children,
  };
}

function operations(overrides: Record<string, unknown> = {}): ExplorerOperations {
  return {
    chooseWorkspace: vi.fn().mockResolvedValue({ ok: true, value: '/work' }),
    refresh: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    createFile: vi.fn().mockResolvedValue({ ok: true, value: '/work/new.md' }),
    createFolder: vi.fn().mockResolvedValue({ ok: true, value: '/work/new-folder' }),
    move: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    rename: vi.fn().mockResolvedValue({ ok: true, value: '/work/renamed.md' }),
    delete: vi.fn().mockResolvedValue({ ok: true, value: { status: 'committed', deleted: [] } }),
    ...overrides,
  } as unknown as ExplorerOperations;
}

function treeFixture(operationOverrides: Record<string, unknown> = {}) {
  const root = '/work';
  const selection = new ExplorerSelection(() => root);
  const operationSet = operations(operationOverrides);
  const onError = vi.fn();
  const tree = new ExplorerTree({
    operations: operationSet,
    getRoot: () => root,
    selection,
    onError,
  });
  return { root, selection, operations: operationSet, tree, onError };
}

function dragEvent(type: string, dataTransfer?: Record<string, unknown>): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event as DragEvent;
}

describe('ExplorerSelection', () => {
  it('handles ranges, collapsed descendants, moves, and deletions', () => {
    const child = file('/work/docs/a.md');
    const folder = directory('/work/docs', [child]);
    const image = file('/work/photo.png', 'image');
    const selection = new ExplorerSelection(() => '/work');

    selection.selectSingle(folder);
    expect(
      selection.updateForClick(image, [folder, image], new MouseEvent('click', { shiftKey: true })),
    ).toBe(true);
    expect(selection.paths).toEqual(['/work/docs', '/work/docs/a.md', '/work/photo.png']);

    selection.removeCollapsedDescendants(folder);
    expect(selection.paths).toEqual(['/work/docs', '/work/photo.png']);
    selection.rewriteAfterMoves([
      { path: '/work/docs', newPath: '/work/archive/docs', isDirectory: true },
    ]);
    expect(selection.paths[0]).toBe('/work/archive/docs');
    selection.removeDeleted(directory('/work/archive/docs'));
    expect(selection.paths).toEqual(['/work/photo.png']);
  });
});

describe('ExplorerTree', () => {
  it('loads, clears selection, collapses descendants, and applies moves', async () => {
    const child = file('/work/docs/a.md');
    const folder = directory('/work/docs', [child]);
    const fixture = treeFixture({
      refresh: vi.fn().mockResolvedValue({ ok: true, value: [folder, file('/work/b.md')] }),
    });
    fixture.selection.selectSingle(child);

    await fixture.tree.loadRoot();
    expect(fixture.tree.entries).toHaveLength(2);
    expect(fixture.selection.paths).toEqual([]);

    fixture.selection.selectSingle(child);
    await fixture.tree.toggleDirectory(folder);
    expect(fixture.selection.paths).toEqual([]);
    fixture.tree.applyMove('/work/b.md', '/work/docs/b.md', '/work/docs');
    expect(fixture.tree.entries[0].children.map((node) => node.path)).toContain('/work/docs/b.md');
  });
});

describe('ExplorerMoveController', () => {
  it('updates tree and selection only after committed moves', async () => {
    const note = file('/work/note.md');
    const folder = directory('/work/docs');
    const committed = {
      path: note.path,
      newPath: '/work/docs/note.md',
      isDirectory: false,
    };
    const fixture = treeFixture({
      move: vi.fn().mockResolvedValue({ ok: true, value: [committed] }),
    });
    fixture.tree.entries = [folder, note];
    fixture.selection.selectSingle(note);
    const onRenamed = vi.fn().mockResolvedValue(undefined);
    const controller = new ExplorerMoveController({
      operations: fixture.operations,
      getRoot: () => fixture.root,
      tree: fixture.tree,
      selection: fixture.selection,
      prompt: vi.fn(),
      onRenamed,
      onError: fixture.onError,
    });

    await controller.moveNodesToDirectory([note], folder.path);

    expect(onRenamed).toHaveBeenCalledWith(note.path, committed.newPath, false);
    expect(fixture.selection.paths).toEqual([committed.newPath]);
    expect(fixture.tree.entries[0].children[0]?.path).toBe(committed.newPath);
  });

  it('preserves state after a complete rollback', async () => {
    const note = file('/work/note.md');
    const fixture = treeFixture({
      move: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: 'move-rolled-back', message: 'restored', cause: new Error('disk') },
      }),
    });
    fixture.tree.entries = [note];
    fixture.selection.selectSingle(note);
    const controller = new ExplorerMoveController({
      operations: fixture.operations,
      getRoot: () => fixture.root,
      tree: fixture.tree,
      selection: fixture.selection,
      prompt: vi.fn(),
      onRenamed: vi.fn(),
      onError: fixture.onError,
    });

    await controller.moveNodesToDirectory([note], '/work/docs');

    expect(fixture.onError).toHaveBeenCalledWith('restored');
    expect(fixture.tree.entries).toEqual([note]);
    expect(fixture.selection.paths).toEqual([note.path]);
  });
});

describe('ExplorerDragController', () => {
  it('sets image payloads, rejects invalid targets, and delegates valid drops', () => {
    const image = file('/work/photo.png', 'image');
    const folder = directory('/work/docs');
    const selection = new ExplorerSelection(() => '/work');
    const moveNodes = vi.fn().mockResolvedValue(undefined);
    const controller = new ExplorerDragController({
      getRoot: () => '/work',
      getEntries: () => [folder, image],
      selection,
      moveNodes,
    });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

    controller.begin(image, dragEvent('dragstart', transfer));
    expect(transfer.setData).toHaveBeenCalledWith(WORKSPACE_ENTRY_DRAG_TYPE, image.path);
    expect(transfer.setData).toHaveBeenCalledWith(WORKSPACE_IMAGE_DRAG_TYPE, image.path);
    controller.overRoot(dragEvent('dragover', transfer));
    expect(transfer.dropEffect).toBe('none');
    controller.dropOnNode(folder, dragEvent('drop', transfer));
    expect(moveNodes).toHaveBeenCalledWith([image], folder.path);
    expect(controller.paths).toEqual([]);
  });
});

describe('ExplorerCommands', () => {
  it('preserves state on cancellation, then renames and deletes selected entries', async () => {
    const note = file('/work/note.md');
    const fixture = treeFixture({
      rename: vi.fn().mockResolvedValue({ ok: true, value: '/work/renamed.md' }),
      delete: vi.fn().mockImplementation(async (_root: string, nodes: FileNode[]) => ({
        ok: true,
        value: { status: 'committed', deleted: nodes },
      })),
    });
    fixture.tree.entries = [note];
    fixture.selection.selectSingle(note);
    const prompt = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('renamed');
    const confirm = vi.fn().mockResolvedValue(true);
    const controller = new ExplorerCommands({
      operations: fixture.operations,
      getRoot: () => fixture.root,
      tree: fixture.tree,
      selection: fixture.selection,
      prompt,
      confirm,
      onOpenFile: vi.fn(),
      onError: fixture.onError,
    });

    await controller.createFile();
    expect(fixture.operations.createFile).not.toHaveBeenCalled();
    await controller.renameSelected();
    expect(fixture.selection.paths).toEqual(['/work/renamed.md']);
    await controller.deleteSelected();
    expect(fixture.tree.entries).toEqual([]);
    expect(fixture.selection.paths).toEqual([]);
  });
});
