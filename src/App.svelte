<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import Editor from './lib/editor/Editor.svelte';
  import { documentManager } from './lib/editor/documentManager';
  import type { EditorApi } from './lib/editor/editorTypes';
  import type { StoredSelection } from './lib/editor/editorTypes';
  import { chooseMarkdownFile } from './lib/files';
  import ActivityBar from './lib/sidebar/ActivityBar.svelte';
  import Sidebar from './lib/sidebar/Sidebar.svelte';
  import { sidebarActions } from './lib/sidebar/sidebarStore';
  import { activeTab, tabsState } from './lib/tabs/tabStore';
  import TitleBar from './lib/titlebar/TitleBar.svelte';
  import { zoomActions } from './lib/titlebar/zoom';
  import ImageViewer from './lib/viewers/ImageViewer.svelte';
  import { setupWebviewGuards } from './lib/platform/webviewGuards';
  import SettingsView from './lib/settings/SettingsView.svelte';
  import { flushSettings } from './lib/settings/settingsStore';
  import CommandPalette from './lib/commands/CommandPalette.svelte';
  import { appCommands, type AppCommandId } from './lib/commands/commands';
  import KeyboardShortcutsView from './lib/shortcuts/KeyboardShortcutsView.svelte';
  import DialogHost from './lib/dialogs/DialogHost.svelte';
  import { dialogState } from './lib/dialogs/dialogStore';

  let busy = $state(false);
  let error = $state<string | null>(null);
  let commandPaletteOpen = $state(false);
  let lastTitle = '';

  async function updateTitle() {
    const tab = get(activeTab);
    const title = tab
      ? `${tab.dirty ? '● ' : ''}${tab.name}${tab.missing ? ' [missing]' : ''} — HyperMD`
      : 'HyperMD';
    if (title === lastTitle) return;
    lastTitle = title;
    try {
      await getCurrentWindow().setTitle(title);
    } catch {
      document.title = title;
    }
  }

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    busy = true;
    error = null;
    try {
      return await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return undefined;
    } finally {
      busy = false;
    }
  }

  async function openDocument() {
    const path = await chooseMarkdownFile();
    if (path) await openDocumentAt(path);
  }

  async function openDocumentAt(path: string): Promise<boolean> {
    return (await run(() => documentManager.open(path))) ?? false;
  }

  function editorReady(editor: EditorApi) {
    documentManager.attachEditor(editor);
  }

  function showError(message: string) {
    error = message;
  }

  async function pasteImage(blob: Blob, selection: StoredSelection): Promise<void> {
    error = null;
    try {
      await documentManager.pasteClipboardImage(blob, selection);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : 'Could not save the pasted image.');
    }
  }

  function commandEnabled(id: AppCommandId): boolean {
    const command = appCommands.find((candidate) => candidate.id === id);
    const tab = get(activeTab);
    if (command?.context === 'markdown') return tab?.type === 'markdown';
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
      else if (id === 'file.exit') await getCurrentWindow().close();
      else if (id === 'edit.undo') await documentManager.execute('undo');
      else if (id === 'edit.redo') await documentManager.execute('redo');
      else if (id === 'edit.cut') await documentManager.execute('cut');
      else if (id === 'edit.copy') await documentManager.execute('copy');
      else if (id === 'edit.paste') await documentManager.execute('paste');
      else if (id === 'edit.selectAll') await documentManager.execute('selectAll');
      else if (id === 'edit.find') documentManager.openFind();
      else if (id === 'tabs.next') documentManager.activateRelative(1);
      else if (id === 'tabs.previous') documentManager.activateRelative(-1);
      else if (id === 'view.toggleSidebar') sidebarActions.toggle();
      else if (id === 'view.explorer') sidebarActions.show('explorer');
      else if (id === 'view.search') sidebarActions.show('search');
      else if (id === 'view.zoomIn') await zoomActions.increase();
      else if (id === 'view.zoomOut') await zoomActions.decrease();
      else if (id === 'view.resetZoom') await zoomActions.reset();
      else if (id === 'preferences.settings') documentManager.openSettings();
      else if (id === 'preferences.keyboardShortcuts') documentManager.openShortcuts();
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const command = event.ctrlKey || event.metaKey;
    if (!command) return;
    const key = event.key.toLowerCase();

    if (get(dialogState)) {
      if (['b', 'f', 'n', 'o', 'p', 's', 'tab', 'w'].includes(key)) event.preventDefault();
      return;
    }

    if (key === 'p' && event.shiftKey && !event.altKey) {
      event.preventDefault();
      commandPaletteOpen = !commandPaletteOpen;
      return;
    }
    if (commandPaletteOpen) return;

    if (key === 'b') {
      event.preventDefault();
      void executeCommand('view.toggleSidebar');
    } else if (key === 'f') {
      event.preventDefault();
      void executeCommand('edit.find');
    } else if (key === 'w') {
      event.preventDefault();
      void executeCommand('file.closeTab');
    } else if (key === 'tab') {
      event.preventDefault();
      void executeCommand(event.shiftKey ? 'tabs.previous' : 'tabs.next');
    } else if (/^[1-9]$/.test(key) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      documentManager.activatePosition(Number(key) - 1);
    } else if (key === 's') {
      event.preventDefault();
      void executeCommand(event.shiftKey ? 'file.saveAs' : 'file.save');
    } else if (key === 'o') {
      event.preventDefault();
      void executeCommand('file.open');
    } else if (key === 'n') {
      event.preventDefault();
      void executeCommand('file.new');
    }
  }

  onMount(() => {
    const cleanupWebviewGuards = setupWebviewGuards({ onError: showError });
    window.addEventListener('keydown', handleKeydown);
    const unsubscribeTitle = activeTab.subscribe(() => void updateTitle());
    let mounted = true;
    let closeDialogOpen = false;
    let unlistenClose: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        if (closeDialogOpen) return;
        closeDialogOpen = true;
        const hasDirtyTabs = get(tabsState).tabs.some((tab) => tab.dirty);
        void (
          hasDirtyTabs
            ? documentManager.prepareWindowClose()
            : Promise.resolve(documentManager.persistSession()).then(() => true)
        )
          .then(async (canClose) => {
            if (!canClose) return;
            await flushSettings();
            await getCurrentWindow().destroy();
          })
          .catch((cause) => showError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => (closeDialogOpen = false));
      })
      .then((unlisten) => {
        if (mounted) unlistenClose = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unlistenClose?.();
      unsubscribeTitle();
      cleanupWebviewGuards();
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<svelte:head><title>HyperMD</title></svelte:head>

<div class="app-frame">
  <div class="app-shell" class:busy>
    <div class="app-navigation">
      <ActivityBar />
      <Sidebar
        onOpenFile={openDocumentAt}
        onBeforeDelete={() => Promise.resolve(true)}
        onDeleted={(path, isDirectory) => documentManager.markMissing(path, isDirectory)}
        onRenamed={(oldPath, newPath, isDirectory) =>
          documentManager.renamePath(oldPath, newPath, isDirectory)}
        onError={showError}
      />
    </div>

    <div class="app-workspace">
      <TitleBar onExit={() => getCurrentWindow().close()} onError={showError} />

      <main class="editor-pane">
        <div class="editor-scroll content-view" class:hidden={$activeTab?.type !== 'markdown'}>
          <section class="document-shell">
            <Editor
              onReady={editorReady}
              onTransaction={(state, changed) => documentManager.handleTransaction(state, changed)}
              onImagePaste={pasteImage}
            />
          </section>
        </div>
        {#if $activeTab?.type === 'image'}
          <ImageViewer path={$activeTab.path} missing={$activeTab.missing} />
        {:else if $activeTab?.type === 'settings'}
          <SettingsView />
        {:else if $activeTab?.type === 'shortcuts'}
          <KeyboardShortcutsView />
        {/if}
      </main>
    </div>
  </div>

  {#if error}
    <button class="error-toast" onclick={() => (error = null)} aria-label="Dismiss error">
      {error}
    </button>
  {/if}

  <CommandPalette
    open={commandPaletteOpen}
    isEnabled={commandEnabled}
    onExecute={executeCommand}
    onClose={() => (commandPaletteOpen = false)}
  />
  <DialogHost />
</div>
