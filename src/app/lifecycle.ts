import { get } from 'svelte/store';
import { activeTab, documentManager, tabsState } from '@/features/documents';
import { disposeThemeObserver, flushSettings } from '@/features/settings';
import { setupWebviewGuards } from '@/platform/tauri/webviewGuards';
import { destroyWindow, onWindowCloseRequested, setWindowTitle } from '@/platform/tauri/window';

type AppLifecycleOptions = {
  onError: (message: string) => void;
  onKeydown: (event: KeyboardEvent) => void;
};

export function setupAppLifecycle(options: AppLifecycleOptions): () => void {
  let lastTitle = '';
  let mounted = true;
  let closeDialogOpen = false;
  let unlistenClose: (() => void) | undefined;

  async function updateTitle(): Promise<void> {
    const tab = get(activeTab);
    const title = tab
      ? `${tab.dirty ? '● ' : ''}${tab.name}${tab.missing ? ' [missing]' : ''} — HyperMD`
      : 'HyperMD';
    if (title === lastTitle) return;
    lastTitle = title;
    try {
      await setWindowTitle(title);
    } catch {
      document.title = title;
    }
  }

  const cleanupWebviewGuards = setupWebviewGuards({ onError: options.onError });
  window.addEventListener('keydown', options.onKeydown);
  const unsubscribeTitle = activeTab.subscribe(() => void updateTitle());

  void onWindowCloseRequested((event) => {
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
        await destroyWindow();
      })
      .catch((cause) => options.onError(cause instanceof Error ? cause.message : String(cause)))
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
    disposeThemeObserver();
    window.removeEventListener('keydown', options.onKeydown);
  };
}
