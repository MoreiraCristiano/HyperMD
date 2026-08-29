import { get } from 'svelte/store';
import {
  activeTab,
  documentManager,
  type EditorApi,
  type StoredSelection,
} from '@/features/documents';
import { isInsideWorkspace, pathName, sidebarActions, sidebarState } from '@/features/workspace';
import { chooseMarkdownFile } from '@/platform/tauri/files';
import { closeWindow } from '@/platform/tauri/window';
import { zoomActions } from './components/titlebar/zoom';
import { appCommands, type AppCommandId } from './commands';

type AppControllerOptions = {
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  openTablePicker: () => void;
};

export function createAppController(options: AppControllerOptions) {
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
    commandEnabled,
    dropWorkspaceImage,
    editorReady,
    executeCommand,
    openDocumentAt,
    pasteImage,
    renameWorkspacePath,
    showError,
  };
}
