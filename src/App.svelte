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
  import TabBar from './lib/tabs/TabBar.svelte';
  import { activeTab, tabsState } from './lib/tabs/tabStore';
  import TitleBar from './lib/titlebar/TitleBar.svelte';
  import { zoomActions } from './lib/titlebar/zoom';
  import ImageViewer from './lib/viewers/ImageViewer.svelte';
  import { setupWebviewGuards } from './lib/platform/webviewGuards';
  import SettingsView from './lib/settings/SettingsView.svelte';
  import { flushSettings } from './lib/settings/settingsStore';

  let busy = $state(false);
  let error = $state<string | null>(null);
  let lastTitle = '';

  async function updateTitle() {
    const tab = get(activeTab);
    const title = tab
      ? `${tab.dirty ? '● ' : ''}${tab.name}${tab.missing ? ' [ausente]' : ''} — HyperMD`
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

  async function saveDocument(saveAs = false): Promise<boolean> {
    return (await run(() => documentManager.save(undefined, saveAs))) ?? false;
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
      showError(
        cause instanceof Error ? cause.message : 'Não foi possível salvar a imagem colada.',
      );
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const command = event.ctrlKey || event.metaKey;
    if (!command) return;
    const key = event.key.toLowerCase();

    if (key === 'b') {
      event.preventDefault();
      sidebarActions.toggle();
    } else if (key === 'w') {
      event.preventDefault();
      void run(() => documentManager.close());
    } else if (key === 'tab') {
      event.preventDefault();
      documentManager.activateRelative(event.shiftKey ? -1 : 1);
    } else if (/^[1-9]$/.test(key) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      documentManager.activatePosition(Number(key) - 1);
    } else if (key === 's') {
      event.preventDefault();
      void saveDocument(event.shiftKey);
    } else if (key === 'o') {
      event.preventDefault();
      void openDocument();
    } else if (key === 'n') {
      event.preventDefault();
      documentManager.newDocument();
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
  <TitleBar
    onNew={() => documentManager.newDocument()}
    onOpen={openDocument}
    onOpenFolder={() => sidebarActions.requestWorkspace()}
    onSave={() => run(() => documentManager.save())}
    onSaveAs={() => run(() => documentManager.save(undefined, true))}
    onCloseTab={() => run(() => documentManager.close())}
    onExit={() => getCurrentWindow().close()}
    onEdit={(command) => documentManager.execute(command)}
    onToggleSidebar={() => sidebarActions.toggle()}
    onExplorer={() => sidebarActions.show('explorer')}
    onSearch={() => sidebarActions.show('search')}
    onZoomIn={zoomActions.increase}
    onZoomOut={zoomActions.decrease}
    onResetZoom={zoomActions.reset}
    onError={showError}
  />

  <div class="app-shell" class:busy>
    <ActivityBar />
    <Sidebar
      onOpenFile={openDocumentAt}
      onBeforeDelete={() => Promise.resolve(true)}
      onDeleted={(path, isDirectory) => documentManager.markMissing(path, isDirectory)}
      onRenamed={(oldPath, newPath, isDirectory) =>
        documentManager.renamePath(oldPath, newPath, isDirectory)}
      onError={showError}
    />

    <main class="editor-pane">
      <TabBar onError={showError} />
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
      {/if}
    </main>
  </div>

  {#if error}
    <button class="error-toast" onclick={() => (error = null)} aria-label="Fechar erro">
      {error}
    </button>
  {/if}
</div>
