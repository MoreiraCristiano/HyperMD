import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentManager, type ImageReferenceRenamePlan } from '@/features/documents';
import { sidebarState } from '@/features/workspace';
import { tauriMocks } from '@/test/tauriMocks';
import { createAppController } from './appController';

const referencePlan: ImageReferenceRenamePlan = {
  workspaceRoot: '/work',
  oldImagePath: '/work/image.png',
  newImagePath: '/work/renamed.png',
  documents: [
    { path: '/work/a.md', original: 'old a', originalRevision: 'rev-a', updated: 'new a' },
    { path: '/work/b.md', original: 'old b', originalRevision: 'rev-b', updated: 'new b' },
  ],
};

function controllerOptions() {
  return {
    setBusy: vi.fn(),
    setError: vi.fn(),
    setRenameProgress: vi.fn(),
    openTablePicker: vi.fn(),
  };
}

describe('app image rename orchestration', () => {
  beforeEach(() => {
    sidebarState.set({
      visible: true,
      width: 240,
      activeView: 'explorer',
      workspacePath: '/work',
      workspaceName: 'Work',
    });
    tauriMocks.exists.mockResolvedValue(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not rename the image when Markdown preflight fails', async () => {
    vi.spyOn(documentManager, 'planWorkspaceImageRename').mockRejectedValue(
      new Error('read denied'),
    );
    const controller = createAppController(controllerOptions());

    await expect(
      controller.renameImageEntry('/work', '/work/image.png', 'renamed', 'image'),
    ).rejects.toThrow('read denied');
    expect(tauriMocks.rename).not.toHaveBeenCalled();
  });

  it('allows cancellation during preflight and never after the first commit', async () => {
    let controller!: ReturnType<typeof createAppController>;
    const write = vi.spyOn(documentManager, 'writeWorkspaceImageRename');
    vi.spyOn(documentManager, 'planWorkspaceImageRename').mockImplementation(
      async (_root, _oldPath, _newPath, options) => {
        options?.onProgress?.({
          phase: 'preflight',
          completed: 1,
          total: 2,
          cancelable: true,
        });
        controller.cancelImageRename();
        if (options?.signal?.aborted) throw new Error('Image rename canceled.');
        return referencePlan;
      },
    );
    controller = createAppController(controllerOptions());

    await expect(
      controller.renameImageEntry('/work', '/work/image.png', 'renamed', 'image'),
    ).rejects.toThrow('canceled');
    expect(tauriMocks.rename).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('rolls the image back when Markdown writes are fully recovered', async () => {
    vi.spyOn(documentManager, 'planWorkspaceImageRename').mockResolvedValue(referencePlan);
    vi.spyOn(documentManager, 'writeWorkspaceImageRename').mockResolvedValue({
      status: 'rolled-back',
      completed: ['/work/a.md'],
      recovered: ['/work/a.md'],
      failure: { kind: 'io-error', path: '/work/b.md', operation: 'write', message: 'failed' },
    });
    const reconcile = vi.spyOn(documentManager, 'reconcileWorkspaceImageRename');
    const controller = createAppController(controllerOptions());

    const result = await controller.renameImageEntry(
      '/work',
      '/work/image.png',
      'renamed',
      'image',
    );

    expect(result).toMatchObject({ status: 'rolled-back', failure: { kind: 'io-error' } });
    expect(tauriMocks.rename.mock.calls).toEqual([
      ['/work/image.png', '/work/renamed.png'],
      ['/work/renamed.png', '/work/image.png'],
    ]);
    expect(reconcile).toHaveBeenCalledWith(referencePlan, []);
  });

  it('returns exact final locations when a Markdown rollback is partial', async () => {
    vi.spyOn(documentManager, 'planWorkspaceImageRename').mockResolvedValue(referencePlan);
    vi.spyOn(documentManager, 'writeWorkspaceImageRename').mockResolvedValue({
      status: 'partial',
      completed: ['/work/a.md', '/work/b.md'],
      recovered: ['/work/b.md'],
      unrecovered: ['/work/a.md'],
      failure: { kind: 'io-error', path: '/work/b.md', operation: 'write', message: 'failed' },
      rollbackFailures: [
        {
          path: '/work/a.md',
          failure: {
            kind: 'io-error',
            path: '/work/a.md',
            operation: 'rollback',
            message: 'restore failed',
          },
        },
      ],
    });
    const reconcile = vi.spyOn(documentManager, 'reconcileWorkspaceImageRename');
    const controller = createAppController(controllerOptions());

    const result = await controller.renameImageEntry(
      '/work',
      '/work/image.png',
      'renamed',
      'image',
    );

    expect(result).toMatchObject({
      status: 'partial',
      imageLocation: 'source',
      imagePath: '/work/image.png',
      documentsAtSource: ['/work/b.md'],
      documentsAtDestination: ['/work/a.md'],
      rollbackFailures: [{ path: '/work/a.md', failure: { kind: 'io-error' } }],
    });
    expect(reconcile).toHaveBeenCalledWith(referencePlan, ['/work/a.md']);
  });

  it('reports and reconciles the destination when the image rollback fails', async () => {
    vi.spyOn(documentManager, 'planWorkspaceImageRename').mockResolvedValue(referencePlan);
    vi.spyOn(documentManager, 'writeWorkspaceImageRename').mockResolvedValue({
      status: 'rolled-back',
      completed: ['/work/a.md', '/work/b.md'],
      recovered: ['/work/b.md', '/work/a.md'],
      failure: { kind: 'io-error', path: '/work/b.md', operation: 'write', message: 'failed' },
    });
    const renamePathOnly = vi.spyOn(documentManager, 'renamePathOnly');
    tauriMocks.rename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('image rollback failed'));
    const controller = createAppController(controllerOptions());

    const result = await controller.renameImageEntry(
      '/work',
      '/work/image.png',
      'renamed',
      'image',
    );

    expect(result).toMatchObject({
      status: 'partial',
      imageLocation: 'destination',
      imagePath: '/work/renamed.png',
      documentsAtSource: ['/work/a.md', '/work/b.md'],
      documentsAtDestination: [],
      rollbackFailures: [{ path: '/work/renamed.png', failure: { kind: 'io-error' } }],
    });
    expect(renamePathOnly).toHaveBeenCalledWith('/work/image.png', '/work/renamed.png', false);
  });
});
