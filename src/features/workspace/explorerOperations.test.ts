import { describe, expect, it, vi } from 'vitest';
import {
  ExplorerOperations,
  type ExplorerOperationsDependencies,
  type FileNode,
} from './explorerOperations';

function node(path: string): FileNode {
  return {
    name: path.split('/').at(-1)!,
    path,
    isDirectory: false,
    type: 'markdown',
    expanded: false,
    loading: false,
    loaded: false,
    children: [],
  };
}

function dependencies(
  overrides: Partial<ExplorerOperationsDependencies> = {},
): ExplorerOperationsDependencies {
  return {
    chooseWorkspace: vi.fn().mockResolvedValue('/work'),
    changeWorkspace: vi.fn().mockResolvedValue(true),
    readDirectory: vi.fn().mockResolvedValue([]),
    createFile: vi.fn().mockResolvedValue('/work/new.md'),
    createFolder: vi.fn().mockResolvedValue('/work/new-folder'),
    moveEntries: vi.fn().mockResolvedValue({ status: 'committed', moves: [] }),
    removeEntry: vi.fn().mockResolvedValue(undefined),
    renameEntry: vi.fn().mockResolvedValue('/work/renamed.md'),
    beforeDelete: vi.fn().mockResolvedValue(true),
    deleted: vi.fn(),
    ...overrides,
  };
}

describe('ExplorerOperations', () => {
  it('creates and refreshes through injected dependencies', async () => {
    const entries = [node('/work/a.md')];
    const injected = dependencies({ readDirectory: vi.fn().mockResolvedValue(entries) });
    const operations = new ExplorerOperations(injected);

    await expect(operations.createFile('/work', '/work', 'new.md')).resolves.toEqual({
      ok: true,
      value: '/work/new.md',
    });
    await expect(operations.createFolder('/work', '/work', 'docs')).resolves.toEqual({
      ok: true,
      value: '/work/new-folder',
    });
    await expect(operations.refresh('/work', '/work')).resolves.toEqual({
      ok: true,
      value: entries,
    });
    expect(injected.createFile).toHaveBeenCalledWith('/work', '/work', 'new.md');
    expect(injected.createFolder).toHaveBeenCalledWith('/work', '/work', 'docs');
  });

  it('chooses and changes workspace as one typed operation', async () => {
    const injected = dependencies();
    const operations = new ExplorerOperations(injected);

    await expect(operations.chooseWorkspace()).resolves.toEqual({ ok: true, value: '/work' });
    expect(injected.changeWorkspace).toHaveBeenCalledWith('/work');
  });

  it('returns typed rename errors instead of throwing', async () => {
    const cause = new Error('rename denied');
    const operations = new ExplorerOperations(
      dependencies({ renameEntry: vi.fn().mockRejectedValue(cause) }),
    );

    await expect(operations.rename('/work/a.md', 'b', false, 'markdown')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'operation',
        operation: 'rename',
        message: 'rename denied',
        cause,
      },
    });
  });

  it('types committed, rolled-back, and partial moves', async () => {
    const move = { path: '/work/a.md', newPath: '/work/docs/a.md', isDirectory: false };
    const moveEntries = vi
      .fn()
      .mockResolvedValueOnce({ status: 'committed', moves: [move] })
      .mockResolvedValueOnce({ status: 'rolled-back', cause: new Error('disk') })
      .mockResolvedValueOnce({
        status: 'partial',
        completed: [move],
        recovered: [],
        unrecovered: [move],
        cause: new Error('disk'),
      });
    const operations = new ExplorerOperations(dependencies({ moveEntries }));

    await expect(operations.move('/work', [move], '/work/docs')).resolves.toEqual({
      ok: true,
      value: [move],
    });
    const rolledBack = await operations.move('/work', [move], '/work/docs');
    expect(rolledBack).toMatchObject({
      ok: false,
      error: { kind: 'move-rolled-back', operation: 'move' },
    });
    const partial = await operations.move('/work', [move], '/work/docs');
    expect(partial).toMatchObject({
      ok: false,
      error: { kind: 'move-partial', unrecovered: [move] },
    });
    expect(moveEntries).toHaveBeenCalledWith('/work', [move], 'docs');
  });

  it('returns deleted entries on success and partial failure', async () => {
    const first = node('/work/a.md');
    const second = node('/work/b.md');
    const removeEntry = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('delete denied'));
    const injected = dependencies({ removeEntry });
    const operations = new ExplorerOperations(injected);

    const result = await operations.delete('/work', [first, second]);

    expect(result).toMatchObject({
      ok: false,
      error: { operation: 'delete', message: 'delete denied' },
      value: { status: 'partial', deleted: [first] },
    });
    expect(injected.deleted).toHaveBeenCalledWith('/work/a.md', false);
  });
});
