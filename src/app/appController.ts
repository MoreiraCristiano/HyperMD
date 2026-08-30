import { get } from 'svelte/store';
import {
  activeTab,
  documentManager,
  type EditorApi,
  type ImageReferenceProgress,
  type ImageReferenceFailure,
  type StoredSelection,
} from '@/features/documents';
import {
  isInsideWorkspace,
  pathName,
  planWorkspaceEntryRename,
  renameWorkspaceEntry,
  sidebarActions,
  sidebarState,
  type WorkspaceFileType,
} from '@/features/workspace';
import { chooseMarkdownFile } from '@/platform/tauri/files';
import { conditionalRenameFile, readFileRevision } from '@/platform/tauri/atomicWrite';
import { closeWindow } from '@/platform/tauri/window';
import { isImagePath } from '@/shared/utils/imageTypes';
import { zoomActions } from './components/titlebar/zoom';
import { appCommands, type AppCommandId } from './commands';

type AppControllerOptions = {
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  setRenameProgress: (progress: ImageReferenceProgress | null) => void;
  openTablePicker: () => void;
};

export type WorkspaceImageRenameResult =
  | { status: 'committed'; newPath: string; documents: string[] }
  | { status: 'rolled-back'; failure: ImageReferenceFailure }
  | {
      status: 'partial';
      failure: ImageReferenceFailure;
      imageLocation: 'source' | 'destination';
      imagePath: string;
      completed: string[];
      recovered: string[];
      documentsAtSource: string[];
      documentsAtDestination: string[];
      rollbackFailures: Array<{ path: string; failure: ImageReferenceFailure }>;
    };

function operationError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function failureMessage(failure: ImageReferenceFailure): string {
  return failure.kind === 'conflict'
    ? `Document conflict: ${failure.path} (${failure.conflict}).`
    : `${failure.path}: ${failure.message}`;
}

export function createAppController(options: AppControllerOptions) {
  let renameAbortController: AbortController | null = null;
  let renameCancelable = false;

  function showError(message: string): void {
    options.setError(message);
  }

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    options.setBusy(true);
    options.setError(null);
    try {
      return await action();
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      options.setBusy(false);
    }
  }

  async function openDocument(): Promise<void> {
    const path = await chooseMarkdownFile();
    if (path) await openDocumentAt(path);
  }

  async function openDocumentAt(path: string): Promise<boolean> {
    return (await run(() => documentManager.open(path))) ?? false;
  }

  async function changeWorkspace(path: string): Promise<boolean> {
    const currentPath = get(sidebarState).workspacePath;
    const sameWorkspace =
      currentPath !== null &&
      isInsideWorkspace(currentPath, path) &&
      isInsideWorkspace(path, currentPath);
    if (sameWorkspace) return true;
    if (currentPath) {
      const closed = await run(() => documentManager.closeWorkspaceTabs(currentPath));
      if (!closed) return false;
    }
    sidebarActions.setWorkspace(path, pathName(path));
    return true;
  }

  function editorReady(editor: EditorApi): void {
    documentManager.attachEditor(editor);
  }

  async function pasteImage(blob: Blob, selection: StoredSelection): Promise<void> {
    options.setError(null);
    try {
      await documentManager.pasteClipboardImage(blob, selection);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : 'Could not save the pasted image.');
    }
  }

  async function dropWorkspaceImage(path: string, selection: StoredSelection): Promise<void> {
    options.setError(null);
    try {
      await documentManager.insertWorkspaceImage(path, selection);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : 'Could not insert the image.');
    }
  }

  async function renameEntry(
    oldPath: string,
    requestedName: string,
    isDirectory: boolean,
    fileType: WorkspaceFileType | null,
  ): Promise<string> {
    const root = get(sidebarState).workspacePath;
    if (!root) throw new Error('No workspace is open.');
    if (!isDirectory && fileType === 'image' && isImagePath(oldPath)) {
      const result = await renameImageEntry(root, oldPath, requestedName, fileType);
      if (result.status === 'committed') return result.newPath;
      if (result.status === 'rolled-back') {
        throw new Error(
          `Could not rename the image. All changes were restored. ${failureMessage(result.failure)}`,
        );
      }
      const inconsistentDocuments =
        result.imageLocation === 'source'
          ? result.documentsAtDestination
          : result.documentsAtSource;
      const paths = [
        ...(result.imageLocation === 'destination' ? [result.imagePath] : []),
        ...inconsistentDocuments,
        ...result.rollbackFailures.map(({ path }) => path),
      ].filter(Boolean);
      throw new Error(
        `Image rename was partially recovered. ${failureMessage(result.failure)} Image: ${result.imagePath}. Updated: ${result.completed.join(', ') || 'none'}. Recovered: ${result.recovered.join(', ') || 'none'}. Manual intervention: ${[...new Set(paths)].join(', ') || 'none'}.`,
      );
    }
    const newPath = await renameWorkspaceEntry(root, oldPath, requestedName, isDirectory, fileType);
    await documentManager.renamePath(oldPath, newPath, isDirectory);
    return newPath;
  }

  async function renameImageEntry(
    root: string,
    oldPath: string,
    requestedName: string,
    fileType: WorkspaceFileType,
  ): Promise<WorkspaceImageRenameResult> {
    const workspacePlan = await planWorkspaceEntryRename(
      root,
      oldPath,
      requestedName,
      false,
      fileType,
    );
    if (workspacePlan.newPath === oldPath) {
      return { status: 'committed', newPath: oldPath, documents: [] };
    }
    const imageRead = await readFileRevision(oldPath);
    if (imageRead.status === 'io-error') throw new Error(imageRead.message);
    const imageRevision = imageRead.revision;
    const abortController = new AbortController();
    renameAbortController = abortController;
    renameCancelable = true;
    options.setBusy(true);
    options.setError(null);
    try {
      const referencePlan = await documentManager.planWorkspaceImageRename(
        root,
        oldPath,
        workspacePlan.newPath,
        {
          signal: abortController.signal,
          onProgress: (progress) => {
            renameCancelable = progress.cancelable;
            options.setRenameProgress(progress);
          },
        },
      );
      renameCancelable = false;
      options.setRenameProgress({
        phase: 'commit',
        completed: 0,
        total: referencePlan.documents.length + 1,
        cancelable: false,
      });
      const imageCommit = await conditionalRenameFile(
        oldPath,
        workspacePlan.newPath,
        imageRevision,
      );
      if (imageCommit.status === 'conflict') {
        throw new Error(
          `Image rename conflict at ${imageCommit.path}: ${imageCommit.kind}. No Markdown files were changed.`,
        );
      }
      if (imageCommit.status === 'io-error') throw new Error(imageCommit.message);
      const writeResult = await documentManager.writeWorkspaceImageRename(referencePlan, {
        onProgress: (progress) => options.setRenameProgress(progress),
      });
      if (writeResult.status === 'committed') {
        documentManager.renamePathOnly(oldPath, workspacePlan.newPath, false);
        await documentManager.reconcileWorkspaceImageRename(referencePlan, writeResult.completed);
        return {
          status: 'committed',
          newPath: workspacePlan.newPath,
          documents: writeResult.completed,
        };
      }

      const rollbackFailures =
        writeResult.status === 'partial' ? [...writeResult.rollbackFailures] : [];
      let imageLocation: 'source' | 'destination' = 'source';
      try {
        const imageRollback = await conditionalRenameFile(
          workspacePlan.newPath,
          oldPath,
          imageRevision,
        );
        if (imageRollback.status !== 'success') {
          imageLocation = 'destination';
          rollbackFailures.push({
            path:
              imageRollback.status === 'conflict' && imageRollback.path === 'destination'
                ? oldPath
                : workspacePlan.newPath,
            failure:
              imageRollback.status === 'conflict'
                ? {
                    kind: 'conflict',
                    path: imageRollback.path === 'destination' ? oldPath : workspacePlan.newPath,
                    conflict: imageRollback.kind,
                  }
                : {
                    kind: 'io-error',
                    path: workspacePlan.newPath,
                    operation: imageRollback.operation,
                    message: imageRollback.message,
                  },
          });
        }
      } catch (cause) {
        imageLocation = 'destination';
        rollbackFailures.push({
          path: workspacePlan.newPath,
          failure: {
            kind: 'io-error',
            path: workspacePlan.newPath,
            operation: 'rename-image-rollback',
            message: operationError(cause).message,
          },
        });
      }
      const documentsAtDestination =
        writeResult.status === 'partial' ? writeResult.unrecovered : [];
      const destinationSet = new Set(documentsAtDestination);
      const documentsAtSource = referencePlan.documents
        .map(({ path }) => path)
        .filter((path) => !destinationSet.has(path));
      await documentManager.reconcileWorkspaceImageRename(referencePlan, documentsAtDestination);
      if (imageLocation === 'destination') {
        documentManager.renamePathOnly(oldPath, workspacePlan.newPath, false);
      }
      if (writeResult.status === 'rolled-back' && imageLocation === 'source') {
        return { status: 'rolled-back', failure: writeResult.failure };
      }
      return {
        status: 'partial',
        failure: writeResult.failure,
        imageLocation,
        imagePath: imageLocation === 'source' ? oldPath : workspacePlan.newPath,
        completed: writeResult.completed,
        recovered: writeResult.recovered,
        documentsAtSource,
        documentsAtDestination,
        rollbackFailures,
      };
    } finally {
      if (renameAbortController === abortController) renameAbortController = null;
      renameCancelable = false;
      options.setRenameProgress(null);
      options.setBusy(false);
    }
  }

  function cancelImageRename(): void {
    if (renameCancelable) renameAbortController?.abort();
  }

  async function renameWorkspacePath(
    oldPath: string,
    newPath: string,
    isDirectory: boolean,
  ): Promise<void> {
    await documentManager.renamePath(oldPath, newPath, isDirectory);
  }

  function commandEnabled(id: AppCommandId): boolean {
    const command = appCommands.find((candidate) => candidate.id === id);
    const tab = get(activeTab);
    if (command?.context === 'markdown') {
      if (tab?.type !== 'markdown') return false;
      if (id === 'insert.table') return documentManager.canInsertTable();
      return true;
    }
    if (command?.context === 'activeTab') return Boolean(tab);
    return true;
  }

  async function executeCommand(id: AppCommandId): Promise<void> {
    if (!commandEnabled(id)) return;
    try {
      if (id === 'file.new') documentManager.newDocument();
      else if (id === 'file.open') await openDocument();
      else if (id === 'file.openFolder') sidebarActions.requestWorkspace();
      else if (id === 'file.save') await run(() => documentManager.save());
      else if (id === 'file.saveAs') await run(() => documentManager.save(undefined, true));
      else if (id === 'file.closeTab') await run(() => documentManager.close());
      else if (id === 'file.exit') await closeWindow();
      else if (id === 'edit.undo') await documentManager.execute('undo');
      else if (id === 'edit.redo') await documentManager.execute('redo');
      else if (id === 'edit.cut') await documentManager.execute('cut');
      else if (id === 'edit.copy') await documentManager.execute('copy');
      else if (id === 'edit.paste') await documentManager.execute('paste');
      else if (id === 'edit.selectAll') await documentManager.execute('selectAll');
      else if (id === 'edit.find') documentManager.openFind();
      else if (id === 'insert.table') options.openTablePicker();
      else if (id === 'tabs.next') documentManager.activateRelative(1);
      else if (id === 'tabs.previous') documentManager.activateRelative(-1);
      else if (id === 'view.toggleSidebar') sidebarActions.toggle();
      else if (id === 'view.explorer') sidebarActions.show('explorer');
      else if (id === 'view.zoomIn') await zoomActions.increase();
      else if (id === 'view.zoomOut') await zoomActions.decrease();
      else if (id === 'view.resetZoom') await zoomActions.reset();
      else if (id === 'preferences.settings') documentManager.openSettings();
      else if (id === 'preferences.keyboardShortcuts') documentManager.openShortcuts();
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return {
    changeWorkspace,
    cancelImageRename,
    commandEnabled,
    dropWorkspaceImage,
    editorReady,
    executeCommand,
    openDocumentAt,
    pasteImage,
    renameEntry,
    renameImageEntry,
    renameWorkspacePath,
    showError,
  };
}
