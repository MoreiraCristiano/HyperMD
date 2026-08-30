<script lang="ts">
  import { onMount } from 'svelte';
  import {
    activeTab,
    documentManager,
    ImageViewer,
    TablePicker,
  } from '@/features/documents';
  import { SettingsView } from '@/features/settings';
  import { ActivityBar, Sidebar } from '@/features/workspace';
  import { closeWindow } from '@/platform/tauri/window';
  import { DialogHost } from '@/shared/ui/dialogs';
  import CommandPalette from './components/CommandPalette.svelte';
  import KeyboardShortcutsView from './components/shortcuts/KeyboardShortcutsView.svelte';
  import TitleBar from './components/titlebar/TitleBar.svelte';
  import { createAppController } from './appController';
  import { setupAppLifecycle } from './lifecycle';
  import { createAppKeydownHandler } from './keyboard';

  const editorComponent = import('@/features/documents/editor/Editor.svelte').then(
    ({ default: component }) => component,
  );
  let markEditorReady!: () => void;
  const editorReadyPromise = new Promise<void>((resolve) => (markEditorReady = resolve));

  let busy = $state(false);
  let error = $state<string | null>(null);
  let commandPaletteOpen = $state(false);
  let tablePickerOpen = $state(false);

  const {
    changeWorkspace,
    commandEnabled,
    dropWorkspaceImage,
    editorReady,
    executeCommand,
    openDocumentAt,
    pasteImage,
    renameWorkspacePath,
    showError,
  } = createAppController({
    setBusy: (value) => (busy = value),
    setError: (message) => (error = message),
    openTablePicker: () => (tablePickerOpen = true),
  });

  const handleKeydown = createAppKeydownHandler({
    isCommandPaletteOpen: () => commandPaletteOpen,
    isTablePickerOpen: () => tablePickerOpen,
    toggleCommandPalette: () => (commandPaletteOpen = !commandPaletteOpen),
    executeCommand,
    activateTabPosition: (position) => documentManager.activatePosition(position),
  });

  function handleEditorReady(editor: Parameters<typeof editorReady>[0]) {
    editorReady(editor);
    markEditorReady();
  }

  onMount(() => {
    let mounted = true;
    let cleanup: (() => void) | undefined;
    void editorReadyPromise.then(() => {
      if (mounted) cleanup = setupAppLifecycle({ onError: showError, onKeydown: handleKeydown });
    });
    return () => {
      mounted = false;
      cleanup?.();
    };
  });
</script>

<svelte:head><title>HyperMD</title></svelte:head>

<div class="app-frame">
  <div class="app-shell" class:busy>
    <div class="app-navigation">
      <ActivityBar
        {commandPaletteOpen}
        settingsActive={$activeTab?.type === 'settings'}
        onOpenCommandPalette={() => (commandPaletteOpen = true)}
        onOpenSettings={() => documentManager.openSettings()}
      />
      <Sidebar
        activePath={$activeTab?.path ?? null}
        onOpenFile={openDocumentAt}
        onChangeWorkspace={changeWorkspace}
        onBeforeDelete={() => Promise.resolve(true)}
        onDeleted={(path, isDirectory) => documentManager.markMissing(path, isDirectory)}
        onRenamed={renameWorkspacePath}
        onError={showError}
      />
    </div>

    <div class="app-workspace">
      <TitleBar onExit={closeWindow} onError={showError} />

      <main class="editor-pane">
        <div class="editor-scroll content-view" class:hidden={$activeTab?.type !== 'markdown'}>
          <section class="document-shell">
            {#await editorComponent then Editor}
              <Editor
                onReady={handleEditorReady}
                onTransaction={(state, changed) =>
                  documentManager.handleTransaction(state, changed)}
                onImagePaste={pasteImage}
                onWorkspaceImageDrop={dropWorkspaceImage}
              />
            {/await}
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
  <TablePicker
    open={tablePickerOpen}
    onSelect={(rows, columns) => {
      tablePickerOpen = false;
      if (!documentManager.insertTable(rows, columns)) {
        showError('A table cannot be inserted at the current selection.');
      }
    }}
    onClose={() => (tablePickerOpen = false)}
  />
  <DialogHost />
</div>
