import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import {
  childPath,
  chooseWorkspace,
  createMarkdownFile,
  createWorkspaceFolder,
  isInsideWorkspace,
  listWorkspaceMarkdownFiles,
  moveWorkspaceEntries,
  pathName,
  planWorkspaceEntryRename,
  commitWorkspaceEntryRename,
  readWorkspaceDirectory,
  relativeWorkspacePath,
  removeWorkspaceEntry,
  renameWorkspaceEntry,
} from './workspaceService';

describe('workspace', () => {
  beforeEach(() => {
    tauriMocks.exists.mockResolvedValue(false);
    tauriMocks.stat.mockResolvedValue({ isDirectory: true });
  });

  it('selects and validates workspace paths', async () => {
    tauriMocks.dialogOpen.mockResolvedValue('C:/Work');
    await expect(chooseWorkspace()).resolves.toBe('C:/Work');
    expect(pathName('C:\\Work\\Folder\\')).toBe('Folder');
    expect(isInsideWorkspace('C:/Work', 'c:\\work\\a.md')).toBe(true);
    expect(isInsideWorkspace('/work', '/workspace/a.md')).toBe(false);
    expect(relativeWorkspacePath('/work', '/work/docs/a.md')).toBe('docs/a.md');
    expect(() => relativeWorkspacePath('/work', '/other/a.md')).toThrow('outside the workspace');
    expect(pathName('')).toBe('');
    expect(relativeWorkspacePath('/work', '/work')).toBe('');
  });

  it('builds child paths and rejects unsafe names', () => {
    expect(childPath('/work', '/work/docs', ' note.md ')).toBe('/work/docs/note.md');
    expect(childPath('C:\\work', 'C:\\work', 'a.md')).toBe('C:\\work\\a.md');
    for (const name of ['', '.', '..', '../escape', '.hidden']) {
      expect(() => childPath('/work', '/work', name)).toThrow();
    }
    expect(() => childPath('/work', '/other', 'a.md')).toThrow('outside the workspace');
  });

  it('filters, classifies, and sorts directory entries', async () => {
    tauriMocks.readDir.mockResolvedValue([
      { name: 'z.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: '.hidden.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'photo.PNG', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'skip.txt', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'Folder', isFile: false, isDirectory: true, isSymlink: false },
      { name: 'link.md', isFile: true, isDirectory: false, isSymlink: true },
    ]);
    const nodes = await readWorkspaceDirectory('/work', '/work');
    expect(nodes.map(({ name, type }) => [name, type])).toEqual([
      ['Folder', null],
      ['photo.PNG', 'image'],
      ['z.md', 'markdown'],
    ]);
  });

  it('lists visible Markdown files recursively', async () => {
    tauriMocks.readDir.mockImplementation(async (path: string) =>
      path === '/work/docs'
        ? [
            { name: 'nested.md', isFile: true, isDirectory: false, isSymlink: false },
            { name: '.hidden.md', isFile: true, isDirectory: false, isSymlink: false },
          ]
        : [
            { name: 'docs', isFile: false, isDirectory: true, isSymlink: false },
            { name: 'root.md', isFile: true, isDirectory: false, isSymlink: false },
            { name: 'image.png', isFile: true, isDirectory: false, isSymlink: false },
          ],
    );
    await expect(listWorkspaceMarkdownFiles('/work')).resolves.toEqual([
      '/work/docs/nested.md',
      '/work/root.md',
    ]);
  });

  it('creates and renames entries with type rules', async () => {
    await expect(createMarkdownFile('/work', '/work', 'note')).resolves.toBe('/work/note.md');
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/work/note.md', '');
    await expect(createWorkspaceFolder('/work', '/work', 'docs')).resolves.toBe('/work/docs');
    expect(tauriMocks.mkdir).toHaveBeenCalledWith('/work/docs');

    await expect(
      renameWorkspaceEntry('/work', '/work/a.md', 'renamed', false, 'markdown'),
    ).resolves.toBe('/work/renamed.md');
    await expect(
      renameWorkspaceEntry('/work', '/work/a.png', 'image', false, 'image'),
    ).resolves.toBe('/work/image.png');
    await expect(
      renameWorkspaceEntry('/work', '/work/a.png', 'image.jpg', false, 'image'),
    ).rejects.toThrow('does not convert images');

    tauriMocks.exists.mockResolvedValue(true);
    await expect(createMarkdownFile('/work', '/work', 'taken')).rejects.toThrow('already exists');
  });

  it('keeps explicit extensions and protects create and rename collisions', async () => {
    await expect(createMarkdownFile('/work', '/work', 'note.md')).resolves.toBe('/work/note.md');
    tauriMocks.exists.mockResolvedValueOnce(true);
    await expect(createWorkspaceFolder('/work', '/work', 'taken')).rejects.toThrow(
      'already exists',
    );

    tauriMocks.exists.mockResolvedValueOnce(true);
    await expect(
      renameWorkspaceEntry('/work', '/work/a.md', 'taken.md', false, 'markdown'),
    ).rejects.toThrow('already exists');
    tauriMocks.exists.mockResolvedValueOnce(true);
    await expect(renameWorkspaceEntry('/work', '/work/docs', 'docs', true, null)).resolves.toBe(
      '/work/docs',
    );
  });

  it('plans rename without mutation and rechecks the destination at commit time', async () => {
    const plan = await planWorkspaceEntryRename(
      '/work',
      '/work/image.png',
      'renamed',
      false,
      'image',
    );
    expect(plan.newPath).toBe('/work/renamed.png');
    expect(tauriMocks.rename).not.toHaveBeenCalled();

    tauriMocks.exists.mockResolvedValueOnce(true);
    await expect(commitWorkspaceEntryRename(plan)).rejects.toThrow('already exists');
    expect(tauriMocks.rename).not.toHaveBeenCalled();
  });

  it('commits every planned move in order', async () => {
    const result = await moveWorkspaceEntries(
      '/work',
      [
        { path: '/work/a.md', isDirectory: false },
        { path: '/work/b.md', isDirectory: false },
      ],
      'docs',
    );
    expect(result).toEqual({
      status: 'committed',
      moves: [
        { path: '/work/a.md', isDirectory: false, newPath: '/work/docs/a.md' },
        { path: '/work/b.md', isDirectory: false, newPath: '/work/docs/b.md' },
      ],
    });
    expect(tauriMocks.rename.mock.calls).toEqual([
      ['/work/a.md', '/work/docs/a.md'],
      ['/work/b.md', '/work/docs/b.md'],
    ]);
  });

  it('rolls completed moves back in reverse order after a later failure', async () => {
    const cause = new Error('disk failure');
    tauriMocks.rename
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(cause)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await moveWorkspaceEntries(
      '/work',
      [
        { path: '/work/a.md', isDirectory: false },
        { path: '/work/b.md', isDirectory: false },
        { path: '/work/c.md', isDirectory: false },
      ],
      'docs',
    );

    expect(result).toEqual({ status: 'rolled-back', cause });
    expect(tauriMocks.rename.mock.calls).toEqual([
      ['/work/a.md', '/work/docs/a.md'],
      ['/work/b.md', '/work/docs/b.md'],
      ['/work/c.md', '/work/docs/c.md'],
      ['/work/docs/b.md', '/work/b.md'],
      ['/work/docs/a.md', '/work/a.md'],
    ]);
  });

  it('reports completed, recovered, and unrecovered moves when rollback fails', async () => {
    const cause = new Error('disk failure');
    const rollbackFailure = new Error('rollback failure');
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    tauriMocks.rename
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(cause)
      .mockRejectedValueOnce(rollbackFailure)
      .mockResolvedValueOnce(undefined);

    const result = await moveWorkspaceEntries(
      '/work',
      [
        { path: '/work/a.md', isDirectory: false },
        { path: '/work/b.md', isDirectory: false },
        { path: '/work/c.md', isDirectory: false },
      ],
      'docs',
    );

    expect(result).toEqual({
      status: 'partial',
      completed: [
        { path: '/work/a.md', isDirectory: false, newPath: '/work/docs/a.md' },
        { path: '/work/b.md', isDirectory: false, newPath: '/work/docs/b.md' },
      ],
      recovered: [{ path: '/work/a.md', isDirectory: false, newPath: '/work/docs/a.md' }],
      unrecovered: [{ path: '/work/b.md', isDirectory: false, newPath: '/work/docs/b.md' }],
      cause,
    });
    expect(report).toHaveBeenCalledWith(
      'Failed to roll back workspace move /work/docs/b.md -> /work/b.md',
      rollbackFailure,
    );
  });

  it('returns rolled-back when the destination becomes occupied after preflight', async () => {
    const cause = new Error('destination occupied');
    tauriMocks.rename.mockRejectedValueOnce(cause);

    await expect(
      moveWorkspaceEntries('/work', [{ path: '/work/a.md', isDirectory: false }], 'docs'),
    ).resolves.toEqual({ status: 'rolled-back', cause });
    expect(tauriMocks.exists).toHaveBeenCalledWith('/work/docs/a.md');
    expect(tauriMocks.rename).toHaveBeenCalledTimes(1);
  });

  it('blocks invalid destinations before moving anything', async () => {
    await expect(moveWorkspaceEntries('/work', [], '../outside')).rejects.toThrow(
      'Invalid destination',
    );
    tauriMocks.stat.mockResolvedValue({ isDirectory: false });
    await expect(moveWorkspaceEntries('/work', [], 'file.md')).rejects.toThrow(
      'destination folder',
    );
  });

  it('handles root moves and rejects recursive, duplicate, and occupied targets', async () => {
    await expect(
      moveWorkspaceEntries('/work', [{ path: '/work/a.md', isDirectory: false }], '.'),
    ).resolves.toEqual({ status: 'committed', moves: [] });
    await expect(
      moveWorkspaceEntries('/work', [{ path: '/work/docs', isDirectory: true }], 'docs/nested'),
    ).rejects.toThrow('inside itself');
    await expect(
      moveWorkspaceEntries(
        '/work',
        [
          { path: '/work/one/a.md', isDirectory: false },
          { path: '/work/two/a.md', isDirectory: false },
        ],
        'docs',
      ),
    ).rejects.toThrow('same name');
    tauriMocks.exists.mockResolvedValueOnce(true);
    await expect(
      moveWorkspaceEntries('/work', [{ path: '/work/a.md', isDirectory: false }], 'docs'),
    ).rejects.toThrow('already exists');
  });

  it('removes files or directories but never workspace root', async () => {
    await removeWorkspaceEntry('/work', '/work/a.md', false);
    expect(tauriMocks.remove).toHaveBeenCalledWith('/work/a.md', { recursive: false });
    await expect(removeWorkspaceEntry('/work', '/work', true)).rejects.toThrow(
      'workspace cannot be deleted',
    );
    await removeWorkspaceEntry('/work', '/work/docs', true);
    expect(tauriMocks.remove).toHaveBeenCalledWith('/work/docs', { recursive: true });
  });
});
